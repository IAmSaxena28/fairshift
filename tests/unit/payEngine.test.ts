import { describe, expect, it } from 'vitest';
import { comparePay, replay, salaryDays } from '../../src/server/domain/payEngine.ts';
import { COLLEGE_FACILITIES, CONSTRUCTION_LABOUR } from '../../src/server/domain/demoPolicies.ts';
import { isoWeekKey, monthPeriod, zonedToUtc } from '../../src/shared/time.ts';
import type { AttendanceEvent, PayTerms } from '../../src/shared/types.ts';

const TZ = 'Asia/Kolkata';
const HOURLY: PayTerms = { basis: 'hourly', ratePaise: 100_00, employedFrom: '2025-01-01' };
const SALARY: PayTerms = { basis: 'monthly', ratePaise: 18_000_00, employedFrom: '2025-01-01' };
const LATE = Date.parse('2026-12-31T00:00:00Z');

/** Builds check-in/check-out events from local wall-clock shifts. */
function shifts(list: Array<[date: string, start: string, endDate: string, end: string]>): AttendanceEvent[] {
  let id = 0;
  return list.flatMap(([date, start, endDate, end]) => [
    { id: ++id, kind: 'check_in' as const, at: zonedToUtc(date, start, TZ), source: 'seed' as const },
    { id: ++id, kind: 'check_out' as const, at: zonedToUtc(endDate, end, TZ), source: 'seed' as const },
  ]);
}

describe('replay: hourly construction policy', () => {
  it('reconstructs a 10-hour day: break, overtime and pay', () => {
    const r = replay({
      events: shifts([['2026-09-07', '08:00', '2026-09-07', '18:00']]),
      rules: CONSTRUCTION_LABOUR,
      terms: HOURLY,
      periodId: '2026-09',
      timeZone: TZ,
      now: LATE,
    });
    expect(r.totals).toMatchObject({
      recordedMinutes: 600,
      breakMinutes: 30,
      payableMinutes: 570,
      ordinaryMinutes: 480,
      overtimeMinutes: 90,
    });
    // 480 min x ₹100/h = ₹800; 90 min x ₹100/h x 2 = ₹300
    expect(r.expected).toMatchObject({ basePaise: 800_00, overtimePaise: 300_00, grossPaise: 1_100_00 });
    expect(r.steps.map((s) => s.id)).toEqual([
      'recorded_time',
      'unpaid_breaks',
      'payable_time',
      'overtime_split',
      'base_pay',
      'overtime_pay',
      'night_allowance',
      'adjustments',
      'expected_gross',
    ]);
    expect(r.steps.at(-1)!.output).toBe(r.expected.grossPaise);
  });

  it('counts overtime only beyond the threshold, to the minute', () => {
    const at = (end: string) =>
      replay({
        events: shifts([['2026-09-07', '08:00', '2026-09-07', end]]),
        rules: CONSTRUCTION_LABOUR,
        terms: HOURLY,
        periodId: '2026-09',
        timeZone: TZ,
        now: LATE,
      }).totals.overtimeMinutes;
    expect(at('16:30')).toBe(0); // 510 - 30 break = 480 payable
    expect(at('16:31')).toBe(1);
  });

  it('applies the daily threshold across two shifts on the same day', () => {
    const r = replay({
      events: shifts([
        ['2026-09-07', '06:00', '2026-09-07', '11:00'],
        ['2026-09-07', '13:00', '2026-09-07', '18:00'],
      ]),
      rules: CONSTRUCTION_LABOUR,
      terms: HOURLY,
      periodId: '2026-09',
      timeZone: TZ,
      now: LATE,
    });
    // Two 300-minute shifts, neither longer than 300 so no break; 600 payable -> 120 overtime.
    expect(r.totals).toMatchObject({ breakMinutes: 0, payableMinutes: 600, overtimeMinutes: 120 });
  });

  it('rounds money once, half away from zero, in paise', () => {
    const r = replay({
      events: shifts([['2026-09-07', '08:00', '2026-09-07', '16:31']]),
      rules: CONSTRUCTION_LABOUR,
      terms: { ...HOURLY, ratePaise: 100_01 },
      periodId: '2026-09',
      timeZone: TZ,
      now: LATE,
    });
    // base: 480 x 10001 / 60 = 80008 exactly; overtime: 1 x 10001 x 2 / 60 = 333.37 -> 333
    expect(r.expected.basePaise).toBe(80_008);
    expect(r.expected.overtimePaise).toBe(333);
    expect(Number.isInteger(r.expected.grossPaise)).toBe(true);
  });

  it('includes authorised adjustments in the expected gross', () => {
    const r = replay({
      events: shifts([['2026-09-07', '08:00', '2026-09-07', '16:30']]),
      rules: CONSTRUCTION_LABOUR,
      terms: HOURLY,
      periodId: '2026-09',
      timeZone: TZ,
      now: LATE,
      adjustments: [
        { id: 1, amountPaise: -200_00, reason: 'Advance repaid' },
        { id: 2, amountPaise: 50_00, reason: 'Travel allowance' },
      ],
    });
    expect(r.expected.adjustmentsPaise).toBe(-150_00);
    expect(r.expected.grossPaise).toBe(800_00 - 150_00);
  });
});

describe('replay: attendance edge cases', () => {
  it('assigns an overnight shift to the day it started and pays the night allowance', () => {
    const r = replay({
      events: shifts([['2026-09-30', '22:00', '2026-10-01', '06:00']]),
      rules: COLLEGE_FACILITIES,
      terms: SALARY,
      periodId: '2026-09',
      timeZone: TZ,
      now: LATE,
    });
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]).toMatchObject({ date: '2026-09-30', grossMinutes: 480, crossesMidnight: true });
    expect(r.totals.payableMinutes).toBe(450);
    expect(r.expected.nightAllowancePaise).toBe(100_00);
  });

  it('uses the organisation time zone, not UTC, to pick the day', () => {
    // 20:30 UTC on 30 Sep is 02:00 IST on 1 Oct.
    const events: AttendanceEvent[] = [
      { id: 1, kind: 'check_in', at: Date.parse('2026-09-30T20:30:00Z'), source: 'seed' },
      { id: 2, kind: 'check_out', at: Date.parse('2026-10-01T04:30:00Z'), source: 'seed' },
    ];
    const base = { events, rules: CONSTRUCTION_LABOUR, terms: HOURLY, timeZone: TZ, now: LATE };
    expect(replay({ ...base, periodId: '2026-09' }).sessions).toHaveLength(0);
    expect(replay({ ...base, periodId: '2026-10' }).sessions[0]!.date).toBe('2026-10-01');
  });

  it('excludes a missed check-out from pay and reports it', () => {
    const checkIn = zonedToUtc('2026-09-07', '08:00', TZ);
    const r = replay({
      events: [{ id: 1, kind: 'check_in', at: checkIn, source: 'worker' }],
      rules: CONSTRUCTION_LABOUR,
      terms: HOURLY,
      periodId: '2026-09',
      timeZone: TZ,
      now: checkIn + 17 * 3_600_000,
    });
    expect(r.sessions[0]!.flag).toBe('missed_check_out');
    expect(r.totals).toMatchObject({ payableMinutes: 0, excludedSessions: 1 });
    expect(r.issues).toEqual([{ code: 'missed_check_out', eventId: 1, at: checkIn }]);
  });

  it('treats a shift still open within the limit as in progress, not missed', () => {
    const checkIn = zonedToUtc('2026-09-07', '08:00', TZ);
    const r = replay({
      events: [{ id: 1, kind: 'check_in', at: checkIn, source: 'worker' }],
      rules: CONSTRUCTION_LABOUR,
      terms: HOURLY,
      periodId: '2026-09',
      timeZone: TZ,
      now: checkIn + 3 * 3_600_000,
    });
    expect(r.sessions[0]!.flag).toBe('in_progress');
    expect(r.issues).toEqual([]);
  });

  it('ignores a duplicate check-in and an orphan check-out', () => {
    const t = (hhmm: string) => zonedToUtc('2026-09-07', hhmm, TZ);
    const r = replay({
      events: [
        { id: 1, kind: 'check_in', at: t('08:00'), source: 'worker' },
        { id: 2, kind: 'check_in', at: t('08:02'), source: 'worker' },
        { id: 3, kind: 'check_out', at: t('16:30'), source: 'worker' },
        { id: 4, kind: 'check_out', at: t('16:31'), source: 'worker' },
      ],
      rules: CONSTRUCTION_LABOUR,
      terms: HOURLY,
      periodId: '2026-09',
      timeZone: TZ,
      now: LATE,
    });
    expect(r.sessions).toHaveLength(1);
    expect(r.totals.recordedMinutes).toBe(510);
    expect(r.issues.map((i) => i.code)).toEqual(['duplicate_check_in', 'orphan_check_out']);
  });

  it('honours a correction that voids a wrong check-out and appends the right one', () => {
    const t = (hhmm: string) => zonedToUtc('2026-09-07', hhmm, TZ);
    const r = replay({
      events: [
        { id: 1, kind: 'check_in', at: t('08:00'), source: 'worker' },
        { id: 2, kind: 'check_out', at: t('12:00'), source: 'worker' },
        { id: 3, kind: 'void', at: t('20:00'), targetId: 2, source: 'admin_correction' },
        { id: 4, kind: 'check_out', at: t('18:00'), source: 'admin_correction' },
      ],
      rules: CONSTRUCTION_LABOUR,
      terms: HOURLY,
      periodId: '2026-09',
      timeZone: TZ,
      now: LATE,
    });
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]).toMatchObject({ checkOutId: 4, grossMinutes: 600 });
  });
});

describe('replay: monthly salary college policy', () => {
  it('counts weekly overtime across a month boundary as one week', () => {
    // ISO week 2026-W40 runs Mon 28 Sep to Sun 4 Oct.
    expect(isoWeekKey('2026-09-28')).toBe(isoWeekKey('2026-10-04'));
    const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
    // Five 12.5-hour shifts with a 30-minute break = 5 x 720 = 3600 payable minutes in the week.
    const events = shifts(days.map((d) => [d, '07:00', d, '19:30'] as [string, string, string, string]));
    const base = { events, rules: COLLEGE_FACILITIES, terms: SALARY, timeZone: TZ, now: LATE };
    const sep = replay({ ...base, periodId: '2026-09' });
    const oct = replay({ ...base, periodId: '2026-10' });
    // Threshold 2880 is reached exactly at the end of the 4th shift (1 Oct); the 5th is all overtime.
    expect(sep.totals.overtimeMinutes).toBe(0);
    expect(oct.totals.overtimeMinutes).toBe(720);
    // ₹18,000 / 208 h x 1.5 x 12 h = ₹1,557.69
    expect(oct.expected.overtimePaise).toBe(1_557_69);
  });

  it('prorates salary for someone who joined mid-month', () => {
    expect(salaryDays('2026-09-16', monthPeriod('2026-09'), '2026-12-01')).toBe(15);
    const r = replay({
      events: [],
      rules: COLLEGE_FACILITIES,
      terms: { ...SALARY, employedFrom: '2026-09-16' },
      periodId: '2026-09',
      timeZone: TZ,
      now: LATE,
    });
    expect(r.expected.basePaise).toBe(9_000_00);
  });

  it('counts salary only up to today while the month is running', () => {
    expect(salaryDays('2025-01-01', monthPeriod('2026-10'), '2026-10-10')).toBe(10);
  });
});

describe('comparePay', () => {
  it('classifies and attributes a shortfall to the component that differs', () => {
    const expected = { basePaise: 800_00, overtimePaise: 300_00, nightAllowancePaise: 0, adjustmentsPaise: 0, grossPaise: 1_100_00 };
    const recorded = { ...expected, overtimePaise: 100_00, grossPaise: 900_00 };
    const c = comparePay(expected, recorded);
    expect(c.status).toBe('underpaid');
    expect(c.differencePaise).toBe(200_00);
    expect(c.components.filter((d) => d.differencePaise !== 0)).toEqual([
      { component: 'overtimePaise', expectedPaise: 300_00, recordedPaise: 100_00, differencePaise: 200_00 },
    ]);
    expect(comparePay(expected, expected).status).toBe('match');
    expect(comparePay(expected, { ...expected, grossPaise: 1_200_00 }).status).toBe('overpaid');
  });
});

describe('replay: a forgotten check-out followed by the next day', () => {
  it('keeps the next shift and flags the unclosed one', () => {
    const r = replay({
      events: [
        { id: 1, kind: 'check_in', at: zonedToUtc('2026-09-07', '08:00', TZ), source: 'worker' },
        { id: 2, kind: 'check_in', at: zonedToUtc('2026-09-08', '08:00', TZ), source: 'worker' },
        { id: 3, kind: 'check_out', at: zonedToUtc('2026-09-08', '16:30', TZ), source: 'worker' },
      ],
      rules: CONSTRUCTION_LABOUR,
      terms: HOURLY,
      periodId: '2026-09',
      timeZone: TZ,
      now: LATE,
    });
    expect(r.sessions.map((s) => [s.date, s.flag])).toEqual([
      ['2026-09-07', 'missed_check_out'],
      ['2026-09-08', null],
    ]);
    expect(r.totals).toMatchObject({ payableMinutes: 480, excludedSessions: 1 });
    expect(r.issues.map((i) => i.code)).toEqual(['missed_check_out']);
  });
});
