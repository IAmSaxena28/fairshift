/**
 * Fatigue rules. Each warning is a plain fact about recorded hours measured against
 * the organisation's configured limits; nothing here predicts or scores a person.
 */
import { addDays, isoWeekKey } from '../../shared/time.ts';
import type { FatigueWarning, PolicyRules, SessionCalc } from '../../shared/types.ts';
import { minutesBetween } from './attendance.ts';

export function fatigueWarnings(sessions: readonly SessionCalc[], limits: PolicyRules['fatigue']): FatigueWarning[] {
  const complete = sessions.filter((s) => s.end !== null).sort((a, b) => a.start - b.start);
  const warnings: FatigueWarning[] = [];

  for (const s of complete) {
    if (s.grossMinutes > limits.maxShiftMinutes) {
      warnings.push({ rule: 'long_shift', date: s.date, value: s.grossMinutes, limit: limits.maxShiftMinutes });
    }
  }

  for (let i = 1; i < complete.length; i++) {
    const prev = complete[i - 1]!;
    const next = complete[i]!;
    const rest = minutesBetween(prev.end!, next.start);
    if (rest < limits.minRestMinutes) {
      warnings.push({ rule: 'short_rest', date: next.date, value: rest, limit: limits.minRestMinutes });
    }
  }

  const weekly = new Map<string, { minutes: number; lastDate: string }>();
  for (const s of complete) {
    const key = isoWeekKey(s.date);
    const entry = weekly.get(key) ?? { minutes: 0, lastDate: s.date };
    entry.minutes += s.payableMinutes;
    entry.lastDate = s.date;
    weekly.set(key, entry);
  }
  for (const { minutes, lastDate } of weekly.values()) {
    if (minutes > limits.maxWeeklyMinutes) {
      warnings.push({ rule: 'weekly_hours', date: lastDate, value: minutes, limit: limits.maxWeeklyMinutes });
    }
  }

  const days = [...new Set(complete.map((s) => s.date))].sort();
  let run = 0;
  let reported = false;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && addDays(days[i - 1]!, 1) === days[i] ? run + 1 : 1;
    if (run === 1) reported = false;
    if (run > limits.maxConsecutiveDays && !reported) {
      warnings.push({ rule: 'consecutive_days', date: days[i]!, value: run, limit: limits.maxConsecutiveDays });
      reported = true;
    }
  }

  return warnings.sort((a, b) => a.date.localeCompare(b.date) || a.rule.localeCompare(b.rule));
}
