/**
 * Fairness Replay pay engine.
 *
 * A pure, deterministic function from (attendance events, policy rules, pay terms, period)
 * to an expected-pay result plus the ordered list of steps that produced it.
 * The web client renders these steps verbatim, so what a worker reads is what was computed.
 */
import { BP_ONE, divRound, payForMinutes, type Paise } from '../../shared/money.ts';
import { addDays, daysBetween, isoWeekKey, localDateKey, monthPeriod, type Period } from '../../shared/time.ts';
import type {
  Adjustment,
  AttendanceEvent,
  ComponentDiff,
  ExpectedPay,
  PayComparison,
  PayrollComponents,
  PayTerms,
  PolicyRules,
  ReplayResult,
  ReplayStep,
  SessionCalc,
} from '../../shared/types.ts';
import { buildSessions, minutesBetween } from './attendance.ts';

export interface ReplayInput {
  events: readonly AttendanceEvent[];
  rules: PolicyRules;
  terms: PayTerms;
  periodId: string;
  timeZone: string;
  now: number;
  adjustments?: readonly Adjustment[];
}

export function replay(input: ReplayInput): ReplayResult {
  const { rules, terms, timeZone, now } = input;
  const period = monthPeriod(input.periodId);
  const { sessions, issues } = buildSessions(input.events, timeZone, now, rules.missedCheckoutAfterMinutes);

  // Split every complete session into ordinary and overtime minutes. All sessions take part,
  // not only this period's, so a week that straddles two months is still counted as one week.
  const calcs: SessionCalc[] = [];
  const bucketTotals = new Map<string, number>();
  for (const s of sessions) {
    const complete = s.end !== null;
    const grossMinutes = complete ? minutesBetween(s.start, s.end!) : 0;
    const breakMinutes =
      complete && grossMinutes > rules.unpaidBreak.afterMinutes ? Math.min(rules.unpaidBreak.minutes, grossMinutes) : 0;
    const payableMinutes = grossMinutes - breakMinutes;

    let overtimeMinutes = 0;
    if (complete && rules.overtime.eligible) {
      const bucket = rules.overtime.mode === 'daily' ? s.date : isoWeekKey(s.date);
      const before = bucketTotals.get(bucket) ?? 0;
      const after = before + payableMinutes;
      bucketTotals.set(bucket, after);
      const threshold = rules.overtime.thresholdMinutes;
      overtimeMinutes = Math.max(0, after - Math.max(before, threshold));
    }

    calcs.push({
      ...s,
      grossMinutes,
      breakMinutes,
      payableMinutes,
      ordinaryMinutes: payableMinutes - overtimeMinutes,
      overtimeMinutes,
      crossesMidnight: complete && localDateKey(s.end!, timeZone) !== s.date,
    });
  }

  const inPeriod = calcs.filter((c) => c.date >= period.start && c.date < period.endExclusive);
  const counted = inPeriod.filter((c) => c.end !== null);
  const sum = (pick: (c: SessionCalc) => number) => counted.reduce((acc, c) => acc + pick(c), 0);

  const totals = {
    recordedMinutes: sum((c) => c.grossMinutes),
    breakMinutes: sum((c) => c.breakMinutes),
    payableMinutes: sum((c) => c.payableMinutes),
    ordinaryMinutes: sum((c) => c.ordinaryMinutes),
    overtimeMinutes: sum((c) => c.overtimeMinutes),
    nightShifts: counted.filter((c) => c.crossesMidnight).length,
    excludedSessions: inPeriod.length - counted.length,
  };

  const steps: ReplayStep[] = [
    {
      id: 'recorded_time',
      rule: 'Sum of check-in to check-out time for completed shifts in the period',
      inputs: { shifts: counted.length, excludedShifts: totals.excludedSessions },
      output: totals.recordedMinutes,
      unit: 'minutes',
    },
    {
      id: 'unpaid_breaks',
      rule: `Shifts longer than ${rules.unpaidBreak.afterMinutes} minutes include an unpaid break`,
      inputs: {
        afterMinutes: rules.unpaidBreak.afterMinutes,
        breakMinutes: rules.unpaidBreak.minutes,
        shiftsWithBreak: counted.filter((c) => c.breakMinutes > 0).length,
      },
      output: totals.breakMinutes,
      unit: 'minutes',
    },
    {
      id: 'payable_time',
      rule: 'Recorded time minus unpaid breaks',
      inputs: { recordedMinutes: totals.recordedMinutes, breakMinutes: totals.breakMinutes },
      output: totals.payableMinutes,
      unit: 'minutes',
    },
    {
      id: 'overtime_split',
      rule: rules.overtime.eligible
        ? `Minutes beyond ${rules.overtime.thresholdMinutes} per ${rules.overtime.mode === 'daily' ? 'day' : 'week'} are overtime`
        : 'This pay group is not eligible for overtime',
      inputs: {
        eligible: rules.overtime.eligible,
        mode: rules.overtime.mode,
        thresholdMinutes: rules.overtime.thresholdMinutes,
        ordinaryMinutes: totals.ordinaryMinutes,
      },
      output: totals.overtimeMinutes,
      unit: 'minutes',
    },
  ];

  // Base pay and the hourly rate that overtime is paid from.
  let basePaise: Paise;
  let overtimePaise: Paise;
  if (terms.basis === 'hourly') {
    basePaise = payForMinutes(totals.ordinaryMinutes, terms.ratePaise);
    overtimePaise = payForMinutes(totals.overtimeMinutes, terms.ratePaise, rules.overtime.multiplierBp);
    steps.push({
      id: 'base_pay',
      rule: 'Ordinary minutes x hourly rate / 60',
      inputs: { basis: 'hourly', minutes: totals.ordinaryMinutes, ratePaisePerHour: terms.ratePaise },
      output: basePaise,
      unit: 'paise',
    });
    steps.push({
      id: 'overtime_pay',
      rule: 'Overtime minutes x hourly rate x overtime multiplier / 60',
      inputs: {
        minutes: totals.overtimeMinutes,
        ratePaisePerHour: terms.ratePaise,
        multiplierBp: rules.overtime.multiplierBp,
      },
      output: overtimePaise,
      unit: 'paise',
    });
  } else {
    const daysCounted = salaryDays(terms.employedFrom, period, localDateKey(now, timeZone));
    basePaise = divRound(terms.ratePaise * daysCounted, period.days);
    // Hourly equivalent of a salary = salary / standard hours. Kept as a fraction until the final rounding.
    overtimePaise = divRound(
      totals.overtimeMinutes * terms.ratePaise * rules.overtime.multiplierBp,
      rules.standardMonthlyMinutes * BP_ONE,
    );
    steps.push({
      id: 'base_pay',
      rule: 'Monthly salary x days counted / days in month',
      inputs: { basis: 'monthly', salaryPaise: terms.ratePaise, daysCounted, daysInPeriod: period.days },
      output: basePaise,
      unit: 'paise',
    });
    steps.push({
      id: 'overtime_pay',
      rule: 'Overtime minutes x (salary / standard monthly hours) x overtime multiplier / 60',
      inputs: {
        minutes: totals.overtimeMinutes,
        ratePaisePerHour: divRound(terms.ratePaise * 60, rules.standardMonthlyMinutes),
        standardMonthlyMinutes: rules.standardMonthlyMinutes,
        multiplierBp: rules.overtime.multiplierBp,
      },
      output: overtimePaise,
      unit: 'paise',
    });
  }

  const nightAllowancePaise = totals.nightShifts * rules.nightAllowancePaise;
  steps.push({
    id: 'night_allowance',
    rule: 'Allowance for each shift that crosses midnight',
    inputs: { nightShifts: totals.nightShifts, allowancePaise: rules.nightAllowancePaise },
    output: nightAllowancePaise,
    unit: 'paise',
  });

  const adjustments = input.adjustments ?? [];
  const adjustmentsPaise = adjustments.reduce((acc, a) => acc + a.amountPaise, 0);
  steps.push({
    id: 'adjustments',
    rule: 'Authorised additions and deductions recorded by the employer',
    inputs: { count: adjustments.length },
    output: adjustmentsPaise,
    unit: 'paise',
  });

  const grossPaise = basePaise + overtimePaise + nightAllowancePaise + adjustmentsPaise;
  steps.push({
    id: 'expected_gross',
    rule: 'Base + overtime + night allowance + adjustments',
    inputs: { basePaise, overtimePaise, nightAllowancePaise, adjustmentsPaise },
    output: grossPaise,
    unit: 'paise',
  });

  const expected: ExpectedPay = { basePaise, overtimePaise, nightAllowancePaise, adjustmentsPaise, grossPaise };
  return { periodId: period.id, terms, sessions: inPeriod, issues, totals, expected, steps };
}

/**
 * Days of salary earned in the period: from the later of the period start and the employment start,
 * up to the period end, or up to today while the period is still running.
 */
export function salaryDays(employedFrom: string, period: Period, today: string): number {
  const from = employedFrom > period.start ? employedFrom : period.start;
  const until = today < period.endExclusive ? (today >= period.start ? addDays(today, 1) : period.start) : period.endExclusive;
  return Math.max(0, daysBetween(from, until));
}


const COMPONENTS = ['basePaise', 'overtimePaise', 'nightAllowancePaise', 'adjustmentsPaise'] as const;

/** Compares what the records suggest with what payroll recorded, component by component. */
export function comparePay(expected: ExpectedPay, recorded: PayrollComponents): PayComparison {
  const components: ComponentDiff[] = COMPONENTS.map((component) => ({
    component,
    expectedPaise: expected[component],
    recordedPaise: recorded[component],
    differencePaise: expected[component] - recorded[component],
  }));
  const differencePaise = expected.grossPaise - recorded.grossPaise;
  const status = differencePaise === 0 ? 'match' : differencePaise > 0 ? 'underpaid' : 'overpaid';
  return { status, differencePaise, components };
}
