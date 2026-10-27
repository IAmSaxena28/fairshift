import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setup } from './helpers.ts';

describe('Journey B: confidential safety report, end to end', () => {
  it('stores no identity, gives a tracking code, and shows the employer response to the code holder', async () => {
    const { app, db, login } = setup();
    const form = await request(app).get('/api/public/orgs/greenfield').expect(200);
    const site = form.body.sites.find((s: { name: string }) => s.name === 'Housekeeping');

    // Even if a signed-in worker's cookie reaches the server, the public route does not read it.
    const priya = await login('priya');
    const sub = await priya
      .post('/api/public/orgs/GREENFIELD/reports')
      .send({ category: 'hazard', urgent: true, description: 'Wet floor near the boiler room has no sign.', siteId: site.id })
      .expect(201);
    expect(Object.keys(sub.body)).toEqual(['trackingCode']);
    expect(sub.body.trackingCode).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);

    const row = db.prepare('SELECT * FROM safety_cases ORDER BY id DESC LIMIT 1').get() as Record<string, unknown>;
    expect(row).toMatchObject({ reporter_user_id: null, created_at: null, confidential: 1 });
    expect(JSON.stringify(row)).not.toContain(sub.body.trackingCode);
    const audit = db.prepare("SELECT actor_user_id, at FROM audit_events WHERE action = 'safety.reported' ORDER BY id DESC LIMIT 1").get() as { actor_user_id: unknown; at: number };
    expect(audit.actor_user_id).toBeNull();
    expect(new Date(audit.at).toISOString()).toBe('2026-10-26T18:30:00.000Z'); // midnight IST, not the submit time

    const anita = await login('anita');
    const list = (await anita.get('/api/admin/safety').expect(200)).body;
    const mine = list.find((c: { description: string }) => c.description.startsWith('Wet floor'));
    expect(mine).toMatchObject({ confidential: true, reporter: null, urgent: true, status: 'submitted' });
    expect((await anita.get('/api/admin/dashboard').expect(200)).body.actions[0]).toMatchObject({ type: 'urgent_case', caseId: mine.id });

    await anita.post(`/api/admin/safety/${mine.id}/transition`).send({ to: 'resolved', note: 'skip' }).expect(409);
    await anita.post(`/api/admin/safety/${mine.id}/transition`).send({ to: 'acknowledged', note: 'Sign placed, area mopped.' }).expect(200);
    await anita.post(`/api/admin/safety/${mine.id}/transition`).send({ to: 'under_review', note: 'Supervisor suspects a pipe leak.', public: false }).expect(200);
    await anita.post(`/api/admin/safety/${mine.id}/transition`).send({ to: 'action_taken', note: 'Plumber replaced the leaking joint.' }).expect(200);
    await anita.post(`/api/admin/safety/${mine.id}/transition`).send({ to: 'resolved', note: 'Floor dry for two days.' }).expect(200);

    const status = await request(app).get(`/api/public/reports/${sub.body.trackingCode.toLowerCase()}`).expect(200);
    expect(status.body.status).toBe('resolved');
    const notes = status.body.events.map((e: { note: string | null }) => e.note);
    expect(notes).toContain('Plumber replaced the leaking joint.');
    expect(notes).not.toContain('Supervisor suspects a pipe leak.');

    await request(app).post(`/api/public/reports/${sub.body.trackingCode}/reopen`).send({ note: 'Floor is wet again today.' }).expect(200);
    expect((await request(app).get(`/api/public/reports/${sub.body.trackingCode}`)).body.status).toBe('under_review');
  });

  it('answers wrong and malformed tracking codes identically', async () => {
    const { app } = setup();
    const wrong = await request(app).get('/api/public/reports/ABCD-EFGH-JKMN').expect(404);
    const malformed = await request(app).get('/api/public/reports/x').expect(404);
    expect(wrong.body).toEqual(malformed.body);
  });

  it('opens a seeded demo case by its published code', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/public/reports/DEMO-CLGE-0001').expect(200);
    expect(res.body).toMatchObject({ category: 'ppe', status: 'under_review' });
  });

  it('does not name a small site on a confidential report', async () => {
    const { app, login } = setup();
    const form = await request(app).get('/api/public/orgs/GREENFIELD').expect(200);
    const maintenance = form.body.sites.find((s: { name: string }) => s.name === 'Maintenance');
    expect(maintenance.small).toBe(true);
    await request(app)
      .post('/api/public/orgs/GREENFIELD/reports')
      .send({ category: 'mistreatment', urgent: false, description: 'Shouted at during the morning briefing.', siteId: maintenance.id })
      .expect(201);
    const anita = await login('anita');
    const c = (await anita.get('/api/admin/safety').expect(200)).body.find((x: { category: string }) => x.category === 'mistreatment');
    expect(c).toMatchObject({ site: null, siteWithheld: true });
  });
});

describe('access control', () => {
  it('rejects anonymous, wrong-role and cross-organisation access', async () => {
    const { app, login } = setup();
    await request(app).get('/api/worker/today').expect(401);
    const ravi = await login('ravi');
    await ravi.get('/api/admin/dashboard').expect(403);

    const lakshmi = await login('lakshmi');
    const { body } = await ravi.post('/api/worker/corrections').send({ kind: 'pay', period: '2026-09' }).expect(201);
    const anita = await login('anita');
    await anita.get(`/api/admin/corrections/${body.id}`).expect(404);
    await anita.post(`/api/admin/corrections/${body.id}/resolve`).send({ outcome: 'no_change', note: 'Trying another org case.' }).expect(404);
    const constructionCase = (await lakshmi.get('/api/admin/safety').expect(200)).body[0];
    await anita.get(`/api/admin/safety/${constructionCase.id}`).expect(404);
    await anita.get('/api/admin/workers/1/pay/2026-09').expect(404);

    const suresh = await login('suresh');
    await suresh.post(`/api/worker/corrections/${body.id}/reopen`).send({ note: 'not mine' }).expect(404);
  });

  it('rejects a tampered session cookie', async () => {
    const { app } = setup();
    const forged = Buffer.from(JSON.stringify({ userId: 1, orgId: 1, role: 'admin', exp: Date.parse('2030-01-01') })).toString('base64url');
    await request(app).get('/api/admin/dashboard').set('Cookie', `fs_session=${forged}.AAAA`).expect(401);
  });

  it('gives the same answer for an unknown user and a wrong password, and rate-limits guessing', async () => {
    const { app } = setup();
    const a = await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'x' }).expect(401);
    const b = await request(app).post('/api/auth/login').send({ username: 'ravi', password: 'x' }).expect(401);
    expect(a.body).toEqual(b.body);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await request(app).post('/api/auth/login').send({ username: 'ravi', password: 'x' })).status;
    expect(last).toBe(429);
  });

  it('requires JSON for state changes and sets security headers', async () => {
    const { login } = setup();
    const ravi = await login('ravi');
    await ravi.post('/api/worker/check-in').type('form').send('a=1').expect(415);
    const res = await ravi.get('/api/worker/today').expect(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('audit chain', () => {
  it('detects a row edited directly in the database', async () => {
    const { db, login } = setup();
    const lakshmi = await login('lakshmi');
    expect((await lakshmi.get('/api/admin/audit/verify').expect(200)).body.valid).toBe(true);
    db.prepare("UPDATE audit_events SET details_json = '{\"grossPaise\":1}' WHERE org_id = 1 AND seq = 3").run();
    const res = await lakshmi.get('/api/admin/audit/verify').expect(200);
    expect(res.body).toMatchObject({ valid: false, brokenAtSeq: 3 });
  });
});
