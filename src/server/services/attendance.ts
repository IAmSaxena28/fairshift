/** Worker check-in/out and the hours views built on the pay engine's session calculations. */
import { insert, one, tx, type Db } from '../db/db.ts';
import { conflict } from '../http/errors.ts';
import { appendAudit } from '../domain/auditChain.ts';
import { buildSessions, openSession } from '../domain/attendance.ts';
import { fatigueWarnings } from '../domain/fatigue.ts';
import { replay } from '../domain/payEngine.ts';
import { addDays, isoWeekKey, localDateKey, periodOf, previousPeriod } from '../../shared/time.ts';
import type { FatigueWarning, SessionCalc } from '../../shared/types.ts';
import { attendanceEvents, policyFor, termsFor, type OrgRow, type UserRow } from './workforce.ts';

export function checkIn(db: Db, org: OrgRow, user: UserRow, now: number) {
  return tx(db, () => {
    const rules = policyFor(db, org.id, user.pay_group ?? '', periodOf(localDateKey(now, org.time_zone))).rules;
    const { sessions } = buildSessions(attendanceEvents(db, user.id), org.time_zone, now, rules.missedCheckoutAfterMinutes);
    if (openSession(sessions)) throw conflict('already_checked_in', 'You are already checked in.');
    const id = insert(
      db,
      `INSERT INTO attendance_events (org_id, user_id, kind, at, source, recorded_at, recorded_by)
       VALUES (?, ?, 'check_in', ?, 'worker', ?, ?)`,
      org.id,
      user.id,
      now,
      now,
      user.id,
    );
    appendAudit(db, { orgId: org.id, at: now, actorUserId: user.id, action: 'attendance.check_in', entity: 'attendance_event', entityId: id, details: {} });
    return { eventId: id, at: now };
  });
}

export function checkOut(db: Db, org: OrgRow, user: UserRow, now: number) {
  return tx(db, () => {
    const rules = policyFor(db, org.id, user.pay_group ?? '', periodOf(localDateKey(now, org.time_zone))).rules;
    const { sessions } = buildSessions(attendanceEvents(db, user.id), org.time_zone, now, rules.missedCheckoutAfterMinutes);
    const open = openSession(sessions);
    if (!open) throw conflict('not_checked_in', 'You are not checked in.');
    const id = insert(
      db,
      `INSERT INTO attendance_events (org_id, user_id, kind, at, source, recorded_at, recorded_by)
       VALUES (?, ?, 'check_out', ?, 'worker', ?, ?)`,
      org.id,
      user.id,
      now,
      now,
      user.id,
    );
    appendAudit(db, {
      orgId: org.id,
      at: now,
      actorUserId: user.id,
      action: 'attendance.check_out',
      entity: 'attendance_event',
      entityId: id,
      details: { checkInId: open.checkInId },
    });
    return { eventId: id, at: now, minutes: Math.floor((now - open.start) / 60_000) };
  });
}

export interface HoursView {
  periodId: string;
  sessions: SessionCalc[];
  issues: ReturnType<typeof replay>['issues'];
  totals: ReturnType<typeof replay>['totals'];
  fatigue: FatigueWarning[];
}

/** Sessions, totals and fatigue warnings for one period. */
export function hoursView(db: Db, org: OrgRow, user: UserRow, periodId: string, now: number): HoursView {
  const policy = policyFor(db, org.id, user.pay_group ?? '', periodId);
  const result = replay({
    events: attendanceEvents(db, user.id),
    rules: policy.rules,
    terms: termsFor(user),
    periodId,
    timeZone: org.time_zone,
    now,
  });
  return {
    periodId,
    sessions: result.sessions,
    issues: result.issues.filter((i) => periodOf(localDateKey(i.at, org.time_zone)) === periodId),
    totals: result.totals,
    fatigue: fatigueWarnings(result.sessions, policy.rules.fatigue),
  };
}

/** Sessions and fatigue warnings for the last `days` days, across a month boundary if needed. */
export function recentSessions(db: Db, org: OrgRow, user: UserRow, now: number, days = 14) {
  const today = localDateKey(now, org.time_zone);
  const from = addDays(today, -days + 1);
  const current = periodOf(today);
  const views = [hoursView(db, org, user, previousPeriod(current), now), hoursView(db, org, user, current, now)];
  const sessions = views.flatMap((v) => v.sessions).filter((s) => s.date >= from);
  const policy = policyFor(db, org.id, user.pay_group ?? '', current);
  return {
    today,
    sessions,
    fatigue: fatigueWarnings(sessions, policy.rules.fatigue),
    missed: views.flatMap((v) => v.sessions).filter((s) => s.flag === 'missed_check_out' && s.date >= addDays(today, -40)),
  };
}

export function todayView(db: Db, org: OrgRow, user: UserRow, now: number) {
  const recent = recentSessions(db, org, user, now, 14);
  const { today } = recent;
  const shift = one<{ id: number; start_at: number; end_at: number; site: string | null }>(
    db,
    `SELECT s.id, s.start_at, s.end_at, si.name AS site FROM shifts s LEFT JOIN sites si ON si.id = s.site_id
      WHERE s.user_id = ? AND s.date = ? ORDER BY s.start_at LIMIT 1`,
    user.id,
    today,
  );
  const open = recent.sessions.find((s) => s.flag === 'in_progress') ?? null;
  const todaysDone = recent.sessions.filter((s) => s.date === today && s.end !== null);
  const minutesToday =
    todaysDone.reduce((acc, s) => acc + s.grossMinutes, 0) + (open ? Math.floor((now - open.start) / 60_000) : 0);
  const week = isoWeekKey(today);
  const weekMinutes = recent.sessions
    .filter((s) => s.end !== null && isoWeekKey(s.date) === week)
    .reduce((acc, s) => acc + s.payableMinutes, 0);
  return {
    today,
    shift: shift ? { id: shift.id, startAt: shift.start_at, endAt: shift.end_at, site: shift.site } : null,
    checkedIn: open ? { since: open.start } : null,
    minutesToday,
    weekMinutes,
    fatigue: recent.fatigue.filter((w) => w.date >= addDays(today, -7)),
    missedCheckOuts: recent.missed.map((s) => ({ checkInId: s.checkInId, date: s.date, start: s.start })),
  };
}
