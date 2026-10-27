import { localDateKey, MINUTE_MS } from '../../shared/time.ts';
import type { AttendanceEvent, AttendanceIssue, WorkSession } from '../../shared/types.ts';

export interface SessionBuildResult {
  sessions: WorkSession[];
  issues: AttendanceIssue[];
}

/**
 * Pairs an append-only stream of attendance events into work sessions.
 *
 * - `void` events withdraw an earlier event (used by approved corrections).
 * - A second check-in while a session is open is recorded as a duplicate and ignored.
 * - A check-out with no open session is recorded as an orphan and ignored.
 * - A session still open after `missedAfterMinutes` is flagged as a missed check-out
 *   and excluded from pay until someone corrects it.
 */
export function buildSessions(
  events: readonly AttendanceEvent[],
  timeZone: string,
  now: number,
  missedAfterMinutes: number,
): SessionBuildResult {
  const voided = new Set(events.filter((e) => e.kind === 'void' && e.targetId != null).map((e) => e.targetId));
  const live = events
    .filter((e) => e.kind !== 'void' && !voided.has(e.id))
    .sort((a, b) => a.at - b.at || a.id - b.id);

  const sessions: WorkSession[] = [];
  const issues: AttendanceIssue[] = [];
  let open: AttendanceEvent | null = null;

  for (const event of live) {
    if (event.kind === 'check_in') {
      if (open && event.at - open.at <= missedAfterMinutes * MINUTE_MS) {
        issues.push({ code: 'duplicate_check_in', eventId: event.id, at: event.at });
        continue;
      }
      if (open) {
        // The previous shift was never closed; it stays unpaid until corrected.
        issues.push({ code: 'missed_check_out', eventId: open.id, at: open.at });
        sessions.push(unclosed(open, timeZone, 'missed_check_out'));
      }
      open = event;
    } else if (event.kind === 'check_out') {
      if (!open) {
        issues.push({ code: 'orphan_check_out', eventId: event.id, at: event.at });
        continue;
      }
      sessions.push({
        checkInId: open.id,
        checkOutId: event.id,
        start: open.at,
        end: event.at,
        date: localDateKey(open.at, timeZone),
        flag: null,
      });
      open = null;
    }
  }

  if (open) {
    const missed = now - open.at > missedAfterMinutes * MINUTE_MS;
    if (missed) issues.push({ code: 'missed_check_out', eventId: open.id, at: open.at });
    sessions.push(unclosed(open, timeZone, missed ? 'missed_check_out' : 'in_progress'));
  }

  return { sessions, issues };
}

function unclosed(checkIn: AttendanceEvent, timeZone: string, flag: WorkSession['flag']): WorkSession {
  return {
    checkInId: checkIn.id,
    checkOutId: null,
    start: checkIn.at,
    end: null,
    date: localDateKey(checkIn.at, timeZone),
    flag,
  };
}

/** The currently open session, if the worker is checked in. */
export function openSession(sessions: readonly WorkSession[]): WorkSession | null {
  const last = sessions.at(-1);
  return last && last.flag === 'in_progress' ? last : null;
}

/** Whole minutes between two instants, counted on minute boundaries. */
export function minutesBetween(start: number, end: number): number {
  return Math.floor(end / MINUTE_MS) - Math.floor(start / MINUTE_MS);
}
