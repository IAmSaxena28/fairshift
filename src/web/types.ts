/** Shapes of API responses used by the web client. */
import type {
  Adjustment,
  AttendanceIssue,
  CorrectionOutcome,
  CorrectionStatus,
  FatigueWarning,
  Industry,
  PayComparison,
  PayrollComponents,
  PayrollStatus,
  PolicyRules,
  ReplayResult,
  ReplayTotals,
  Role,
  SafetyCategory,
  SafetyStatus,
  SessionCalc,
} from '../shared/types.ts';

export interface Me {
  user: { id: number; name: string; role: Role; jobTitle: string; lang: string; site: string | null };
  org: { name: string; industry: Industry; timeZone: string; reportCode: string };
}

export interface TodayData {
  today: string;
  shift: { id: number; startAt: number; endAt: number; site: string | null } | null;
  checkedIn: { since: number } | null;
  minutesToday: number;
  weekMinutes: number;
  fatigue: FatigueWarning[];
  missedCheckOuts: Array<{ checkInId: number; date: string; start: number }>;
  latestPay: { period: string; grossPaise: number; status: PayrollStatus } | null;
  openCases: number;
}

export interface HoursData {
  periodId: string;
  sessions: SessionCalc[];
  issues: AttendanceIssue[];
  totals: ReplayTotals;
  fatigue: FatigueWarning[];
}

export interface PayrollRecord extends PayrollComponents {
  id: number;
  period: string;
  version: number;
  status: PayrollStatus;
  supersedesId: number | null;
  note: string | null;
  createdAt: number;
}

export interface CorrectionSummary {
  id: number;
  status: CorrectionStatus;
  outcome: CorrectionOutcome | null;
  kind: 'pay' | 'attendance';
  period: string;
}

export interface PayData {
  replay: ReplayResult;
  policy: { id: number; version: number; hash: string; effectivePeriod: string; payGroup: string; rules: PolicyRules };
  payroll: PayrollRecord | null;
  history: PayrollRecord[];
  comparison: PayComparison | null;
  adjustments: Adjustment[];
  correction?: CorrectionSummary | null;
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

export interface WorkerCases {
  corrections: Array<{
    id: number;
    kind: 'pay' | 'attendance';
    period: string;
    status: CorrectionStatus;
    outcome: CorrectionOutcome | null;
    expectedPaise: number | null;
    recordedPaise: number | null;
    createdAt: number;
    events: CaseEvent[];
  }>;
  safety: Array<{
    id: number;
    category: SafetyCategory;
    urgent: boolean;
    description: string;
    status: SafetyStatus;
    createdOn: string;
    events: CaseEvent[];
  }>;
}

export interface AdminSafetyCase {
  id: number;
  confidential: boolean;
  reporter: string | null;
  site: string | null;
  siteWithheld: boolean;
  category: SafetyCategory;
  urgent: boolean;
  description: string;
  status: SafetyStatus;
  createdOn: string;
  acknowledgedAt: number | null;
  resolvedAt: number | null;
  updatedAt: number;
  overdue: boolean;
}
