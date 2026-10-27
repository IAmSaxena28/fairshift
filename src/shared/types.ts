/** Domain types shared by the API and the web client. */
import type { Paise } from './money.ts';

export type Industry = 'construction' | 'college';
export type Role = 'worker' | 'admin';
export type Lang = 'en' | 'ta' | 'hi';

/** Rules an organisation applies to one pay group. Stored as versioned JSON. */
export interface PolicyRules {
  overtime: {
    eligible: boolean;
    /** Overtime counts minutes beyond the threshold within each local day or ISO week. */
    mode: 'daily' | 'weekly';
    thresholdMinutes: number;
    /** 15000 = 1.5x */
    multiplierBp: number;
  };
  unpaidBreak: { afterMinutes: number; minutes: number };
  /** Paid once for each shift that crosses local midnight. */
  nightAllowancePaise: Paise;
  /** Monthly-salary staff only: hours that the salary covers, used for the overtime hourly rate. */
  standardMonthlyMinutes: number;
  fatigue: {
    maxShiftMinutes: number;
    minRestMinutes: number;
    maxWeeklyMinutes: number;
    maxConsecutiveDays: number;
  };
  /** An open shift older than this is treated as a missed check-out. */
  missedCheckoutAfterMinutes: number;
}

/** What a specific worker is paid. */
export interface PayTerms {
  basis: 'hourly' | 'monthly';
  /** Paise per hour for hourly staff, paise per month for salaried staff. */
  ratePaise: Paise;
  /** First day of employment ("YYYY-MM-DD"), used to prorate monthly salary. */
  employedFrom: string;
}

export type AttendanceKind = 'check_in' | 'check_out' | 'void';

export interface AttendanceEvent {
  id: number;
  kind: AttendanceKind;
  at: number;
  /** For `void` events: the event being withdrawn. */
  targetId?: number | null;
  source: 'worker' | 'admin_correction' | 'seed';
}

export type SessionFlag = 'missed_check_out' | 'in_progress';
export type AttendanceIssueCode = 'duplicate_check_in' | 'orphan_check_out' | 'missed_check_out';

export interface AttendanceIssue {
  code: AttendanceIssueCode;
  eventId: number;
  at: number;
}

export interface WorkSession {
  checkInId: number;
  checkOutId: number | null;
  start: number;
  end: number | null;
  /** Local calendar date of the check-in: an overnight shift belongs to the day it started. */
  date: string;
  flag: SessionFlag | null;
}

export interface SessionCalc extends WorkSession {
  grossMinutes: number;
  breakMinutes: number;
  payableMinutes: number;
  ordinaryMinutes: number;
  overtimeMinutes: number;
  crossesMidnight: boolean;
}

export interface Adjustment {
  id: number;
  amountPaise: Paise;
  reason: string;
}

export type ReplayStepId =
  | 'recorded_time'
  | 'unpaid_breaks'
  | 'payable_time'
  | 'overtime_split'
  | 'base_pay'
  | 'overtime_pay'
  | 'night_allowance'
  | 'adjustments'
  | 'expected_gross';

/** One step of a pay calculation. The UI renders exactly these values. */
export interface ReplayStep {
  id: ReplayStepId;
  rule: string;
  inputs: Record<string, number | string | boolean>;
  output: number;
  unit: 'minutes' | 'paise';
}

export interface ReplayTotals {
  recordedMinutes: number;
  breakMinutes: number;
  payableMinutes: number;
  ordinaryMinutes: number;
  overtimeMinutes: number;
  nightShifts: number;
  excludedSessions: number;
}

export interface ExpectedPay {
  basePaise: Paise;
  overtimePaise: Paise;
  nightAllowancePaise: Paise;
  adjustmentsPaise: Paise;
  grossPaise: Paise;
}

export interface ReplayResult {
  periodId: string;
  terms: PayTerms;
  sessions: SessionCalc[];
  issues: AttendanceIssue[];
  totals: ReplayTotals;
  expected: ExpectedPay;
  steps: ReplayStep[];
}

/** Components of a payroll record as the employer's payroll entered them. */
export interface PayrollComponents {
  basePaise: Paise;
  overtimePaise: Paise;
  nightAllowancePaise: Paise;
  adjustmentsPaise: Paise;
  grossPaise: Paise;
}

export type PayrollStatus = 'calculated' | 'approved' | 'paid';

export interface ComponentDiff {
  component: keyof Omit<PayrollComponents, 'grossPaise'>;
  expectedPaise: Paise;
  recordedPaise: Paise;
  differencePaise: Paise;
}

export interface PayComparison {
  status: 'match' | 'underpaid' | 'overpaid';
  /** expected - recorded. Positive means the records suggest the worker is owed money. */
  differencePaise: Paise;
  components: ComponentDiff[];
}

export interface FatigueWarning {
  rule: 'long_shift' | 'short_rest' | 'weekly_hours' | 'consecutive_days';
  date: string;
  value: number;
  limit: number;
}

export type CorrectionStatus = 'open' | 'under_review' | 'resolved';
export type CorrectionOutcome = 'corrected' | 'no_change';

export type SafetyStatus = 'submitted' | 'acknowledged' | 'under_review' | 'action_taken' | 'resolved';
export type SafetyCategory =
  | 'hazard'
  | 'equipment'
  | 'ppe'
  | 'workload'
  | 'wages'
  | 'mistreatment'
  | 'other';
