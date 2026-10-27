/**
 * Pay and attendance correction cases: worker asks, employer reviews, a reasoned outcome is recorded.
 * A correction never edits history: it appends a payroll version or attendance events.
 */
import { all, insert, one, run, tx, type Db } from '../db/db.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import { appendAudit } from '../domain/auditChain.ts';
import { buildSessions } from '../domain/attendance.ts';
import { localDateKey, periodOf } from '../../shared/time.ts';
import type { CorrectionOutcome, CorrectionStatus } from '../../shared/types.ts';
import { attendanceEvents, getUser, payView, policyFor, type OrgRow, type UserRow } from './workforce.ts';

export interface CorrectionRow {
  id: number;
  org_id: number;
  user_id: number;
  period: string;
  kind: 'pay' | 'attendance';
  status: CorrectionStatus;
  outcome: CorrectionOutcome | null;
  worker_note: string | null;
  expected_paise: number | null;
  recorded_paise: number | null;
  check_in_event_id: number | null;
  proposed_check_out_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface CaseEvent {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  public: boolean;
  actorRole: string;
  at: number;
}

export function caseEvents(db: Db, caseType: 'correction' | 'safety', caseId: number, publicOnly: boolean): CaseEvent[] {
  return all<{ id: number; from_status: string | null; to_status: string; note: string | null; public: number; actor_role: string; at: number }>(
    db,
    `SELECT id, from_status, to_status, note, public, actor_role, at FROM case_events
      WHERE case_type = ? AND case_id = ? ${publicOnly ? 'AND public = 1' : ''} ORDER BY at, id`,
    caseType,
    caseId,
  ).map((r) => ({ id: r.id, fromStatus: r.from_status, toStatus: r.to_status, note: r.note, public: r.public === 1, actorRole: r.actor_role, at: r.at }));
}

export function addCaseEvent(
  db: Db,
  e: { orgId: number; caseType: 'correction' | 'safety'; caseId: number; from: string | null; to: string; note: string | null; public?: boolean; actorUserId: number | null; actorRole: 'worker' | 'admin' | 'reporter' | 'system'; at: number },
): void {
  insert(
    db,
    `INSERT INTO case_events (org_id, case_type, case_id, from_status, to_status, note, public, actor_user_id, actor_role, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.orgId,
    e.caseType,
    e.caseId,
    e.from,
    e.to,
    e.note,
    e.public === false ? 0 : 1,
    e.actorUserId,
    e.actorRole,
    e.at,
  );
}

function getCorrection(db: Db, orgId: number, id: number): CorrectionRow {
  const row = one<CorrectionRow>(db, 'SELECT * FROM correction_cases WHERE id = ? AND org_id = ?', id, orgId);
  if (!row) throw notFound();
  return row;
}

function assertNoOpenCase(db: Db, userId: number, period: string, kind: string, checkInId: number | null): void {
  const existing = one<{ id: number }>(
    db,
    `SELECT id FROM correction_cases WHERE user_id = ? AND period = ? AND kind = ? AND status != 'resolved'
       AND (? IS NULL OR check_in_event_id = ?)`,
    userId,
    period,
    kind,
    checkInId,
    checkInId,
  );
  if (existing) throw conflict('case_already_open', 'A request for this is already open.');
}

/** Worker asks for a pay check. Snapshots the expected and recorded amounts the worker saw. */
export function requestPayCorrection(db: Db, org: OrgRow, user: UserRow, periodId: string, note: string | null, now: number) {
  return tx(db, () => {
    const view = payView(db, org, user, periodId, now);
    if (!view.payroll) throw badRequest('no_payroll', 'There is no payroll record for this month yet.');
    assertNoOpenCase(db, user.id, periodId, 'pay', null);
    const id = insert(
      db,
      `INSERT INTO correction_cases (org_id, user_id, period, kind, status, worker_note, expected_paise, recorded_paise, created_at, updated_at)
       VALUES (?, ?, ?, 'pay', 'open', ?, ?, ?, ?, ?)`,
      org.id,
      user.id,
      periodId,
      note,
      view.replay.expected.grossPaise,
      view.payroll.grossPaise,
      now,
      now,
    );
    addCaseEvent(db, { orgId: org.id, caseType: 'correction', caseId: id, from: null, to: 'open', note, actorUserId: user.id, actorRole: 'worker', at: now });
    appendAudit(db, {
      orgId: org.id,
      at: now,
      actorUserId: user.id,
      action: 'correction.requested',
      entity: 'correction_case',
      entityId: id,
      details: { kind: 'pay', period: periodId, expectedPaise: view.replay.expected.grossPaise, recordedPaise: view.payroll.grossPaise, payrollVersion: view.payroll.version },
    });
    return { id };
  });
}

/** Worker reports the time they actually left for a shift with a missed check-out. */
export function requestAttendanceCorrection(
  db: Db,
  org: OrgRow,
  user: UserRow,
  checkInEventId: number,
  proposedCheckOutAt: number,
  note: string | null,
  now: number,
) {
  return tx(db, () => {
    const events = attendanceEvents(db, user.id);
    const rules = policyFor(db, org.id, user.pay_group ?? '', periodOf(localDateKey(now, org.time_zone))).rules;
    const session = buildSessions(events, org.time_zone, now, rules.missedCheckoutAfterMinutes).sessions.find(
      (s) => s.checkInId === checkInEventId,
    );
    if (!session || session.flag !== 'missed_check_out') {
      throw badRequest('not_missed', 'That shift does not have a missed check-out.');
    }
    if (proposedCheckOutAt <= session.start || proposedCheckOutAt - session.start > 24 * 3_600_000 || proposedCheckOutAt > now) {
      throw badRequest('invalid_time', 'The check-out time must be after check-in and within 24 hours.');
    }
    const period = periodOf(session.date);
    assertNoOpenCase(db, user.id, period, 'attendance', checkInEventId);
    const id = insert(
      db,
      `INSERT INTO correction_cases (org_id, user_id, period, kind, status, worker_note, check_in_event_id, proposed_check_out_at, created_at, updated_at)
       VALUES (?, ?, ?, 'attendance', 'open', ?, ?, ?, ?, ?)`,
      org.id,
      user.id,
      period,
      note,
      checkInEventId,
      proposedCheckOutAt,
      now,
      now,
    );
    addCaseEvent(db, { orgId: org.id, caseType: 'correction', caseId: id, from: null, to: 'open', note, actorUserId: user.id, actorRole: 'worker', at: now });
    appendAudit(db, {
      orgId: org.id,
      at: now,
      actorUserId: user.id,
      action: 'correction.requested',
      entity: 'correction_case',
      entityId: id,
      details: { kind: 'attendance', checkInEventId, proposedCheckOutAt },
    });
    return { id };
  });
}

export function startReview(db: Db, org: OrgRow, admin: UserRow, id: number, now: number) {
  return tx(db, () => {
    const c = getCorrection(db, org.id, id);
    if (c.status !== 'open') throw conflict('invalid_transition', 'Only open requests can be taken into review.');
    run(db, "UPDATE correction_cases SET status = 'under_review', updated_at = ? WHERE id = ?", now, id);
    addCaseEvent(db, { orgId: org.id, caseType: 'correction', caseId: id, from: 'open', to: 'under_review', note: null, actorUserId: admin.id, actorRole: 'admin', at: now });
    appendAudit(db, { orgId: org.id, at: now, actorUserId: admin.id, action: 'correction.review_started', entity: 'correction_case', entityId: id, details: {} });
  });
}

export interface ResolveInput {
  outcome: CorrectionOutcome;
  note: string;
  /** Attendance corrections only: the check-out time the employer accepts, defaults to the worker's proposal. */
  checkOutAt?: number;
}

/**
 * Records the employer's decision. "corrected" appends a new payroll version (pay) or
 * a check-out event (attendance); "no_change" requires a written reason.
 */
export function resolveCorrection(db: Db, org: OrgRow, admin: UserRow, id: number, input: ResolveInput, now: number) {
  return tx(db, () => {
    const c = getCorrection(db, org.id, id);
    if (c.status === 'resolved') throw conflict('invalid_transition', 'This request is already resolved.');
    const worker = getUser(db, org.id, c.user_id);
    const details: Record<string, unknown> = { outcome: input.outcome, kind: c.kind };

    if (input.outcome === 'corrected' && c.kind === 'pay') {
      const view = payView(db, org, worker, c.period, now);
      const prev = view.payroll!;
      const e = view.replay.expected;
      if (e.grossPaise === prev.grossPaise) throw conflict('nothing_to_correct', 'Payroll already matches the records.');
      const payrollId = insert(
        db,
        `INSERT INTO payroll_records (org_id, user_id, period, version, base_paise, overtime_paise, night_allowance_paise,
           adjustments_paise, gross_paise, status, supersedes_id, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
        org.id,
        worker.id,
        c.period,
        prev.version + 1,
        e.basePaise,
        e.overtimePaise,
        e.nightAllowancePaise,
        e.adjustmentsPaise,
        e.grossPaise,
        prev.id,
        `Correction #${c.id}: ${input.note}`,
        admin.id,
        now,
      );
      Object.assign(details, { payrollId, supersedes: prev.id, fromPaise: prev.grossPaise, toPaise: e.grossPaise, policyVersion: view.policy.version, policyHash: view.policy.hash });
      appendAudit(db, { orgId: org.id, at: now, actorUserId: admin.id, action: 'payroll.revised', entity: 'payroll_record', entityId: payrollId, details });
    }

    if (input.outcome === 'corrected' && c.kind === 'attendance') {
      const at = input.checkOutAt ?? c.proposed_check_out_at!;
      if (at <= 0) throw badRequest('invalid_time', 'A check-out time is required.');
      const eventId = insert(
        db,
        `INSERT INTO attendance_events (org_id, user_id, kind, at, source, recorded_at, recorded_by, reason)
         VALUES (?, ?, 'check_out', ?, 'admin_correction', ?, ?, ?)`,
        org.id,
        worker.id,
        at,
        now,
        admin.id,
        `Correction #${c.id}: ${input.note}`,
      );
      // The check-out must close the right shift: reject if another event now sits between them.
      const between = one<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM attendance_events WHERE user_id = ? AND kind != 'void' AND at > (SELECT at FROM attendance_events WHERE id = ?) AND at < ?`,
        worker.id,
        c.check_in_event_id,
        at,
      );
      if ((between?.n ?? 0) > 0) throw badRequest('overlaps_next_shift', 'That time overlaps a later check-in.');
      Object.assign(details, { attendanceEventId: eventId, checkInEventId: c.check_in_event_id, checkOutAt: at });
      appendAudit(db, { orgId: org.id, at: now, actorUserId: admin.id, action: 'attendance.corrected', entity: 'attendance_event', entityId: eventId, details });
    }

    run(db, "UPDATE correction_cases SET status = 'resolved', outcome = ?, updated_at = ? WHERE id = ?", input.outcome, now, id);
    addCaseEvent(db, { orgId: org.id, caseType: 'correction', caseId: id, from: c.status, to: 'resolved', note: input.note, actorUserId: admin.id, actorRole: 'admin', at: now });
    appendAudit(db, { orgId: org.id, at: now, actorUserId: admin.id, action: 'correction.resolved', entity: 'correction_case', entityId: id, details: { outcome: input.outcome } });
  });
}

/** The worker disagrees with the outcome and sends it back for review. */
export function reopenCorrection(db: Db, org: OrgRow, user: UserRow, id: number, note: string, now: number) {
  return tx(db, () => {
    const c = getCorrection(db, org.id, id);
    if (c.user_id !== user.id) throw notFound();
    if (c.status !== 'resolved') throw conflict('invalid_transition', 'Only resolved requests can be reopened.');
    run(db, "UPDATE correction_cases SET status = 'under_review', outcome = NULL, updated_at = ? WHERE id = ?", now, id);
    addCaseEvent(db, { orgId: org.id, caseType: 'correction', caseId: id, from: 'resolved', to: 'under_review', note, actorUserId: user.id, actorRole: 'worker', at: now });
    appendAudit(db, { orgId: org.id, at: now, actorUserId: user.id, action: 'correction.reopened', entity: 'correction_case', entityId: id, details: {} });
  });
}

export function markPaid(db: Db, org: OrgRow, admin: UserRow, payrollId: number, now: number) {
  return tx(db, () => {
    const row = one<{ id: number; status: string; user_id: number; period: string; version: number }>(
      db,
      'SELECT id, status, user_id, period, version FROM payroll_records WHERE id = ? AND org_id = ?',
      payrollId,
      org.id,
    );
    if (!row) throw notFound();
    if (row.status !== 'approved') throw conflict('invalid_transition', 'Only approved amounts can be marked as paid.');
    run(db, "UPDATE payroll_records SET status = 'paid' WHERE id = ?", payrollId);
    appendAudit(db, { orgId: org.id, at: now, actorUserId: admin.id, action: 'payroll.marked_paid', entity: 'payroll_record', entityId: payrollId, details: { period: row.period, version: row.version } });
  });
}

export function listCorrections(db: Db, orgId: number, filter: { userId?: number } = {}) {
  return all<CorrectionRow & { worker_name: string }>(
    db,
    `SELECT c.*, u.name AS worker_name FROM correction_cases c JOIN users u ON u.id = c.user_id
      WHERE c.org_id = ? AND (? IS NULL OR c.user_id = ?)
      ORDER BY CASE c.status WHEN 'resolved' THEN 1 ELSE 0 END, c.updated_at DESC`,
    orgId,
    filter.userId ?? null,
    filter.userId ?? null,
  );
}

export function correctionDetail(db: Db, org: OrgRow, id: number, now: number, publicOnly: boolean) {
  const c = getCorrection(db, org.id, id);
  const worker = getUser(db, org.id, c.user_id);
  return {
    correction: { ...c, worker_name: worker.name },
    events: caseEvents(db, 'correction', id, publicOnly),
    pay: payView(db, org, worker, c.period, now),
  };
}
