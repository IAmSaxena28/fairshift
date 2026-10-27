import { describe, expect, it } from 'vitest';
import { setup } from './helpers.ts';

describe('Journey A: construction wage discrepancy, end to end through the API', () => {
  it('detects the seeded gap, takes a correction and records a new payroll version without losing the old one', async () => {
    const { login } = setup();
    const ravi = await login('ravi');

    const before = await ravi.get('/api/worker/pay/2026-09').expect(200);
    expect(before.body.comparison.status).toBe('underpaid');
    expect(before.body.comparison.differencePaise).toBe(1_200_00);
    const gap = before.body.comparison.components.filter((c: { differencePaise: number }) => c.differencePaise !== 0);
    expect(gap).toEqual([expect.objectContaining({ component: 'overtimePaise', differencePaise: 1_200_00 })]);
    expect(before.body.replay.steps.at(-1).output).toBe(before.body.replay.expected.grossPaise);
    expect(before.body.adjustments).toEqual([expect.objectContaining({ amountPaise: -500_00, reason: 'Advance repaid' })]);

    const created = await ravi.post('/api/worker/corrections').send({ kind: 'pay', period: '2026-09', note: 'Overtime looks short' }).expect(201);
    await ravi.post('/api/worker/corrections').send({ kind: 'pay', period: '2026-09' }).expect(409);

    const lakshmi = await login('lakshmi');
    const queue = await lakshmi.get('/api/admin/corrections').expect(200);
    expect(queue.body).toHaveLength(1);
    const detail = await lakshmi.get(`/api/admin/corrections/${created.body.id}`).expect(200);
    expect(detail.body.correction).toMatchObject({ expected_paise: before.body.replay.expected.grossPaise, recorded_paise: before.body.payroll.grossPaise });

    await lakshmi.post(`/api/admin/corrections/${created.body.id}/review`).send({}).expect(200);
    await lakshmi
      .post(`/api/admin/corrections/${created.body.id}/resolve`)
      .send({ outcome: 'corrected', note: 'Gate register confirms the overtime; top-up approved.' })
      .expect(200);

    const after = await ravi.get('/api/worker/pay/2026-09').expect(200);
    expect(after.body.comparison.status).toBe('match');
    expect(after.body.history.map((h: { version: number; status: string }) => [h.version, h.status])).toEqual([
      [2, 'approved'],
      [1, 'paid'],
    ]);
    expect(after.body.history[1].grossPaise).toBe(before.body.payroll.grossPaise);
    expect(after.body.correction).toMatchObject({ status: 'resolved', outcome: 'corrected' });

    const cases = await ravi.get('/api/worker/cases').expect(200);
    expect(cases.body.corrections[0].events.map((e: { toStatus: string }) => e.toStatus)).toEqual(['open', 'under_review', 'resolved']);

    await lakshmi.post(`/api/admin/payroll/${after.body.payroll.id}/mark-paid`).send({}).expect(200);
    await lakshmi.post(`/api/admin/payroll/${after.body.payroll.id}/mark-paid`).send({}).expect(409);

    const verify = await lakshmi.get('/api/admin/audit/verify').expect(200);
    expect(verify.body.valid).toBe(true);
    const audit = await lakshmi.get('/api/admin/audit?limit=10').expect(200);
    expect(audit.body.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['correction.requested', 'correction.review_started', 'payroll.revised', 'correction.resolved', 'payroll.marked_paid']),
    );
  });

  it('requires a written reason to refuse a correction, and lets the worker reopen it', async () => {
    const { login } = setup();
    const ravi = await login('ravi');
    const { body } = await ravi.post('/api/worker/corrections').send({ kind: 'pay', period: '2026-09' }).expect(201);
    const lakshmi = await login('lakshmi');
    await lakshmi.post(`/api/admin/corrections/${body.id}/resolve`).send({ outcome: 'no_change', note: 'no' }).expect(400);
    await lakshmi.post(`/api/admin/corrections/${body.id}/resolve`).send({ outcome: 'no_change', note: 'Overtime was not approved in advance.' }).expect(200);
    await ravi.post(`/api/worker/corrections/${body.id}/reopen`).send({ note: 'My supervisor asked me to stay.' }).expect(200);
    const detail = await lakshmi.get(`/api/admin/corrections/${body.id}`).expect(200);
    expect(detail.body.correction.status).toBe('under_review');
  });

  it('reuses the same engine for the college: monthly salary, weekly overtime, night allowance', async () => {
    const { login } = setup();
    const selvam = await login('selvam');
    const { body } = await selvam.get('/api/worker/pay/2026-09').expect(200);
    expect(body.replay.terms.basis).toBe('monthly');
    expect(body.policy.rules.overtime.mode).toBe('weekly');
    expect(body.replay.totals.nightShifts).toBeGreaterThan(0);
    expect(body.replay.expected.nightAllowancePaise).toBe(body.replay.totals.nightShifts * 100_00);
    expect(body.comparison.status).toBe('match');
  });
});

describe('attendance', () => {
  it('checks in once, refuses a duplicate, and checks out', async () => {
    const { login, clock } = setup();
    const selvam = await login('selvam');
    await selvam.post('/api/worker/check-in').send({}).expect(201);
    await selvam.post('/api/worker/check-in').send({}).expect(409);
    const today = await selvam.get('/api/worker/today').expect(200);
    expect(today.body.checkedIn).not.toBeNull();
    clock.now += 8 * 3_600_000;
    const out = await selvam.post('/api/worker/check-out').send({}).expect(201);
    expect(out.body.minutes).toBe(480);
    await selvam.post('/api/worker/check-out').send({}).expect(409);
  });

  it('fixes a missed check-out through an approved attendance correction', async () => {
    const { login } = setup();
    const suresh = await login('suresh');
    const today = await suresh.get('/api/worker/today').expect(200);
    expect(today.body.missedCheckOuts).toHaveLength(1);
    const missed = today.body.missedCheckOuts[0];

    await suresh
      .post('/api/worker/corrections')
      .send({ kind: 'attendance', checkInEventId: missed.checkInId, checkOutDate: missed.date, checkOutTime: '16:05', note: 'Forgot to check out' })
      .expect(201);

    const lakshmi = await login('lakshmi');
    const [c] = (await lakshmi.get('/api/admin/corrections').expect(200)).body;
    await lakshmi.post(`/api/admin/corrections/${c.id}/resolve`).send({ outcome: 'corrected', note: 'Matches the site gate register.' }).expect(200);

    const after = await suresh.get('/api/worker/today').expect(200);
    expect(after.body.missedCheckOuts).toHaveLength(0);
    const hours = await suresh.get(`/api/worker/hours?period=${missed.date.slice(0, 7)}`).expect(200);
    const fixed = hours.body.sessions.find((s: { checkInId: number }) => s.checkInId === missed.checkInId);
    expect(fixed.flag).toBeNull();
    expect(fixed.payableMinutes).toBeGreaterThan(400);
  });

  it('assigns a shift and rejects an overlapping one', async () => {
    const { login, db } = setup();
    const lakshmi = await login('lakshmi');
    const meena = db.prepare("SELECT id FROM users WHERE username = 'meena'").get() as { id: number };
    await lakshmi.post('/api/admin/shifts').send({ userId: meena.id, date: '2026-11-08', start: '08:00', end: '16:00' }).expect(201);
    await lakshmi.post('/api/admin/shifts').send({ userId: meena.id, date: '2026-11-08', start: '12:00', end: '20:00' }).expect(409);
  });
});

describe('versioned pay policy', () => {
  it('applies a new rule from this month on without changing last month', async () => {
    const { login } = setup();
    const anita = await login('anita');
    const before = (await anita.get('/api/admin/policy').expect(200)).body.groups[0].current.rules;
    const change = { ...before, overtime: { ...before.overtime, multiplierBp: 20_000 } };
    const payload = { payGroup: 'facilities', note: 'Union agreement', ...change };
    await anita.post('/api/admin/policy').send({ ...payload, effectivePeriod: '2026-09' }).expect(400);
    await anita.post('/api/admin/policy').send({ ...payload, effectivePeriod: '2026-10' }).expect(201);

    const selvam = await login('selvam');
    const sep = (await selvam.get('/api/worker/pay/2026-09').expect(200)).body;
    const oct = (await selvam.get('/api/worker/pay/2026-10').expect(200)).body;
    expect(sep.policy.version).toBe(1);
    expect(sep.comparison.status).toBe('match');
    expect(oct.policy.version).toBe(2);
    expect(oct.policy.hash).not.toBe(sep.policy.hash);
  });
});
