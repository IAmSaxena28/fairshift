import { describe, expect, it } from 'vitest';
import { fatigueWarnings } from '../../src/server/domain/fatigue.ts';
import { replay } from '../../src/server/domain/payEngine.ts';
import { COLLEGE_FACILITIES } from '../../src/server/domain/demoPolicies.ts';
import { divRound, formatINR, payForMinutes } from '../../src/shared/money.ts';
import { localDateKey, monthPeriod, zonedToUtc } from '../../src/shared/time.ts';
import type { AttendanceEvent } from '../../src/shared/types.ts';

const TZ = 'Asia/Kolkata';

describe('money', () => {
  it('rounds half away from zero', () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(4, 3)).toBe(1);
    expect(divRound(0, 7)).toBe(0);
  });
  it('rejects non-integer inputs', () => {
    expect(() => divRound(1.5, 2)).toThrow(RangeError);
  });
  it('pays minutes at an hourly rate', () => {
    expect(payForMinutes(60, 95_00)).toBe(95_00);
    expect(payForMinutes(30, 95_00, 20_000)).toBe(95_00);
  });
  it('formats rupees in Indian grouping', () => {
    expect(formatINR(1_23_456_78)).toBe('₹1,23,456.78');
  });
});

describe('time', () => {
  it('converts IST wall time to UTC and back', () => {
    const t = zonedToUtc('2026-10-01', '02:00', TZ);
    expect(new Date(t).toISOString()).toBe('2026-09-30T20:30:00.000Z');
    expect(localDateKey(t, TZ)).toBe('2026-10-01');
  });
  it('handles a zone with daylight saving', () => {
    // 2026-03-29 01:30 in London is after the clocks went forward (BST, UTC+1).
    expect(new Date(zonedToUtc('2026-03-29', '12:00', 'Europe/London')).toISOString()).toBe('2026-03-29T11:00:00.000Z');
  });
  it('builds month periods including leap years', () => {
    expect(monthPeriod('2028-02')).toMatchObject({ days: 29, endExclusive: '2028-03-01' });
    expect(() => monthPeriod('2026-13')).toThrow(RangeError);
  });
});

describe('fatigueWarnings', () => {
  function sessionsFor(list: Array<[string, string, string, string]>) {
    let id = 0;
    const events: AttendanceEvent[] = list.flatMap(([d, s, ed, e]) => [
      { id: ++id, kind: 'check_in' as const, at: zonedToUtc(d, s, TZ), source: 'seed' as const },
      { id: ++id, kind: 'check_out' as const, at: zonedToUtc(ed, e, TZ), source: 'seed' as const },
    ]);
    return replay({
      events,
      rules: COLLEGE_FACILITIES,
      terms: { basis: 'monthly', ratePaise: 18_000_00, employedFrom: '2025-01-01' },
      periodId: '2026-09',
      timeZone: TZ,
      now: Date.parse('2026-12-01T00:00:00Z'),
    }).sessions;
  }

  it('flags a long shift and a short rest between shifts', () => {
    const w = fatigueWarnings(
      sessionsFor([
        ['2026-09-01', '06:00', '2026-09-01', '19:00'],
        ['2026-09-01', '22:00', '2026-09-02', '06:00'],
      ]),
      COLLEGE_FACILITIES.fatigue,
    );
    expect(w).toEqual([
      { rule: 'long_shift', date: '2026-09-01', value: 780, limit: 720 },
      { rule: 'short_rest', date: '2026-09-01', value: 180, limit: 660 },
    ]);
  });

  it('flags more than 48 payable hours in a week and a seventh consecutive day', () => {
    const days = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];
    const w = fatigueWarnings(
      sessionsFor(days.map((d) => [d, '08:00', d, '16:30'])),
      COLLEGE_FACILITIES.fatigue,
    );
    expect(w.map((x) => x.rule)).toEqual(['consecutive_days', 'weekly_hours']);
    expect(w.find((x) => x.rule === 'weekly_hours')).toMatchObject({ value: 7 * 480, limit: 2880 });
  });

  it('returns nothing for a normal week', () => {
    const days = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
    expect(fatigueWarnings(sessionsFor(days.map((d) => [d, '08:00', d, '16:30'])), COLLEGE_FACILITIES.fatigue)).toEqual([]);
  });
});
