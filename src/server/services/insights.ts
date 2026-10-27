/**
 * Employer overview. Every figure is computed from stored records on request;
 * nothing is cached, estimated or scored per person.
 */
import { all, type Db } from '../db/db.ts';
import { addDays, daysBetween, isoWeekKey, localDateKey, periodOf, previousPeriod } from '../../shared/time.ts';
import type { FatigueWarning } from '../../shared/types.ts';
import { recentSessions } from './attendance.ts';
import { listCorrections } from './corrections.ts';
import { listSafetyCases } from './safety.ts';
import { listWorkers, listSites, payView, type OrgRow } from './workforce.ts';

export type ActionItem =
  | { type: 'urgent_case'; caseId: number; category: string; site: string | null; createdOn: string }
  | { type: 'correction'; caseId: number; worker: string; kind: 'pay' | 'attendance'; status: string; since: number }
  | { type: 'discrepancy'; userId: number; worker: string; period: string; differencePaise: number }
  | { type: 'missed_check_out'; userId: number; worker: string; date: string }
  | { type: 'fatigue'; userId: number; worker: string; warning: FatigueWarning };

export function dashboard(db: Db, org: OrgRow, now: number) {
  const today = localDateKey(now, org.time_zone);
  const lastPeriod = previousPeriod(periodOf(today));
  const week = isoWeekKey(today);
  const workers = listWorkers(db, org.id);
  const siteNames = new Map(listSites(db, org.id).map((s) => [s.id, s.name]));
  const actions: ActionItem[] = [];

  const scheduledToday = all<{ n: number }>(db, 'SELECT COUNT(DISTINCT user_id) AS n FROM shifts WHERE org_id = ? AND date = ?', org.id, today)[0]?.n ?? 0;

  let checkedInNow = 0;
  let matching = 0;
  let discrepancies = 0;
  let underpaidPaise = 0;
  const fatigueCounts: Record<FatigueWarning['rule'], number> = { long_shift: 0, short_rest: 0, weekly_hours: 0, consecutive_days: 0 };
  const bySite = new Map<string, { site: string; workers: number; payableMinutes: number; overtimeMinutes: number }>();

  for (const w of workers) {
    const recent = recentSessions(db, org, w, now, 14);
    if (recent.sessions.some((s) => s.flag === 'in_progress')) checkedInNow++;
    for (const s of recent.missed) actions.push({ type: 'missed_check_out', userId: w.id, worker: w.name, date: s.date });
    for (const warning of recent.fatigue) {
      fatigueCounts[warning.rule]++;
      actions.push({ type: 'fatigue', userId: w.id, worker: w.name, warning });
    }

    const siteName = (w.site_id && siteNames.get(w.site_id)) || 'Unassigned';
    const site = bySite.get(siteName) ?? { site: siteName, workers: 0, payableMinutes: 0, overtimeMinutes: 0 };
    site.workers++;
    for (const s of recent.sessions) {
      if (s.end !== null && isoWeekKey(s.date) === week) {
        site.payableMinutes += s.payableMinutes;
        site.overtimeMinutes += s.overtimeMinutes;
      }
    }
    bySite.set(siteName, site);

    const pay = payView(db, org, w, lastPeriod, now);
    if (pay.comparison) {
      if (pay.comparison.status === 'match') matching++;
      else {
        discrepancies++;
        if (pay.comparison.differencePaise > 0) underpaidPaise += pay.comparison.differencePaise;
        actions.push({ type: 'discrepancy', userId: w.id, worker: w.name, period: lastPeriod, differencePaise: pay.comparison.differencePaise });
      }
    }
  }

  const corrections = listCorrections(db, org.id);
  for (const c of corrections.filter((c) => c.status !== 'resolved')) {
    actions.push({ type: 'correction', caseId: c.id, worker: c.worker_name, kind: c.kind, status: c.status, since: c.created_at });
  }

  const cases = listSafetyCases(db, org, now);
  for (const c of cases.filter((c) => c.urgent && c.status !== 'resolved')) {
    actions.unshift({ type: 'urgent_case', caseId: c.id, category: c.category, site: c.site, createdOn: c.createdOn });
  }

  const resolved = cases.filter((c) => c.resolvedAt !== null);
  const daysToResolve = resolved
    .map((c) => daysBetween(c.createdOn, localDateKey(c.resolvedAt!, org.time_zone)))
    .sort((a, b) => a - b);
  const categories = [...new Set(cases.map((c) => c.category))];

  return {
    org: { name: org.name, industry: org.industry },
    today,
    workforce: {
      workers: workers.length,
      scheduledToday,
      checkedInNow,
      missedCheckOuts: actions.filter((a) => a.type === 'missed_check_out').length,
    },
    pay: {
      period: lastPeriod,
      checked: matching + discrepancies,
      matching,
      discrepancies,
      underpaidPaise,
      openCorrections: corrections.filter((c) => c.status !== 'resolved').length,
    },
    safety: {
      open: cases.filter((c) => c.status !== 'resolved').length,
      urgentOpen: cases.filter((c) => c.urgent && c.status !== 'resolved').length,
      overdue: cases.filter((c) => c.overdue).length,
      medianDaysToResolve: daysToResolve.length ? daysToResolve[Math.floor((daysToResolve.length - 1) / 2)]! : null,
      byCategory: categories
        .map((category) => ({
          category,
          open: cases.filter((c) => c.category === category && c.status !== 'resolved').length,
          resolved: cases.filter((c) => c.category === category && c.status === 'resolved').length,
        }))
        .sort((a, b) => b.open + b.resolved - (a.open + a.resolved)),
    },
    hours: {
      week,
      weekStart: addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)),
      bySite: [...bySite.values()].sort((a, b) => a.site.localeCompare(b.site)),
      fatigueCounts,
    },
    actions,
  };
}
