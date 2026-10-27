/** Loading organisations, people, policies and pay records, scoped to one organisation. */
import { all, one, type Db } from '../db/db.ts';
import { notFound } from '../http/errors.ts';
import { comparePay, replay } from '../domain/payEngine.ts';
import type {
  Adjustment,
  AttendanceEvent,
  Industry,
  PayComparison,
  PayrollComponents,
  PayrollStatus,
  PayTerms,
  PolicyRules,
  ReplayResult,
  Role,
} from '../../shared/types.ts';

export interface OrgRow {
  id: number;
  slug: string;
  name: string;
  industry: Industry;
  time_zone: string;
  report_code: string;
  min_group_size: number;
  urgent_ack_hours: number;
}

export interface UserRow {
  id: number;
  org_id: number;
  site_id: number | null;
  role: Role;
  username: string;
  name: string;
  job_title: string;
  pay_group: string | null;
  pay_basis: 'hourly' | 'monthly' | null;
  rate_paise: number | null;
  employed_from: string | null;
  lang: string;
}

export interface PolicyVersion {
  id: number;
  payGroup: string;
  version: number;
  effectivePeriod: string;
  hash: string;
  rules: PolicyRules;
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

const USER_COLUMNS =
  'id, org_id, site_id, role, username, name, job_title, pay_group, pay_basis, rate_paise, employed_from, lang';

export function getOrg(db: Db, orgId: number): OrgRow {
  const org = one<OrgRow>(db, 'SELECT * FROM orgs WHERE id = ?', orgId);
  if (!org) throw notFound();
  return org;
}

/** A user in the given organisation. Users of other organisations are reported as not found. */
export function getUser(db: Db, orgId: number, userId: number): UserRow {
  const user = one<UserRow>(db, `SELECT ${USER_COLUMNS} FROM users WHERE id = ? AND org_id = ?`, userId, orgId);
  if (!user) throw notFound();
  return user;
}

export function listWorkers(db: Db, orgId: number): UserRow[] {
  return all<UserRow>(db, `SELECT ${USER_COLUMNS} FROM users WHERE org_id = ? AND role = 'worker' ORDER BY name`, orgId);
}

export function listSites(db: Db, orgId: number): Array<{ id: number; name: string; headcount: number }> {
  return all(
    db,
    `SELECT s.id, s.name, COUNT(u.id) AS headcount
       FROM sites s LEFT JOIN users u ON u.site_id = s.id AND u.role = 'worker'
      WHERE s.org_id = ? GROUP BY s.id ORDER BY s.name`,
    orgId,
  );
}

/** The policy version in force for a period: the latest version whose effective period has started. */
export function policyFor(db: Db, orgId: number, payGroup: string, periodId: string): PolicyVersion {
  const row = one<{ id: number; pay_group: string; version: number; effective_period: string; hash: string; rules_json: string }>(
    db,
    `SELECT id, pay_group, version, effective_period, hash, rules_json FROM policies
      WHERE org_id = ? AND pay_group = ? AND effective_period <= ?
      ORDER BY version DESC LIMIT 1`,
    orgId,
    payGroup,
    periodId,
  );
  if (!row) throw notFound();
  return {
    id: row.id,
    payGroup: row.pay_group,
    version: row.version,
    effectivePeriod: row.effective_period,
    hash: row.hash,
    rules: JSON.parse(row.rules_json) as PolicyRules,
  };
}

export function termsFor(user: UserRow): PayTerms {
  if (!user.pay_basis || user.rate_paise == null || !user.employed_from) throw notFound();
  return { basis: user.pay_basis, ratePaise: user.rate_paise, employedFrom: user.employed_from };
}

export function attendanceEvents(db: Db, userId: number): AttendanceEvent[] {
  return all<{ id: number; kind: AttendanceEvent['kind']; at: number; target_id: number | null; source: AttendanceEvent['source'] }>(
    db,
    'SELECT id, kind, at, target_id, source FROM attendance_events WHERE user_id = ? ORDER BY at, id',
    userId,
  ).map((r) => ({ id: r.id, kind: r.kind, at: r.at, targetId: r.target_id, source: r.source }));
}

export function adjustmentsFor(db: Db, userId: number, periodId: string): Adjustment[] {
  return all<{ id: number; amount_paise: number; reason: string }>(
    db,
    'SELECT id, amount_paise, reason FROM adjustments WHERE user_id = ? AND period = ? ORDER BY id',
    userId,
    periodId,
  ).map((r) => ({ id: r.id, amountPaise: r.amount_paise, reason: r.reason }));
}

interface PayrollRow {
  id: number;
  period: string;
  version: number;
  base_paise: number;
  overtime_paise: number;
  night_allowance_paise: number;
  adjustments_paise: number;
  gross_paise: number;
  status: PayrollStatus;
  supersedes_id: number | null;
  note: string | null;
  created_at: number;
}

function toRecord(r: PayrollRow): PayrollRecord {
  return {
    id: r.id,
    period: r.period,
    version: r.version,
    basePaise: r.base_paise,
    overtimePaise: r.overtime_paise,
    nightAllowancePaise: r.night_allowance_paise,
    adjustmentsPaise: r.adjustments_paise,
    grossPaise: r.gross_paise,
    status: r.status,
    supersedesId: r.supersedes_id,
    note: r.note,
    createdAt: r.created_at,
  };
}

/** All versions of a worker's payroll record for a period, newest first. */
export function payrollHistory(db: Db, userId: number, periodId: string): PayrollRecord[] {
  return all<PayrollRow>(
    db,
    'SELECT * FROM payroll_records WHERE user_id = ? AND period = ? ORDER BY version DESC',
    userId,
    periodId,
  ).map(toRecord);
}

export function payrollPeriods(db: Db, userId: number): Array<{ period: string; grossPaise: number; status: PayrollStatus }> {
  return all<{ period: string; gross_paise: number; status: PayrollStatus }>(
    db,
    `SELECT p.period, p.gross_paise, p.status FROM payroll_records p
      WHERE p.user_id = ? AND p.version = (SELECT MAX(version) FROM payroll_records q WHERE q.user_id = p.user_id AND q.period = p.period)
      ORDER BY p.period DESC`,
    userId,
  ).map((r) => ({ period: r.period, grossPaise: r.gross_paise, status: r.status }));
}

export interface PayView {
  replay: ReplayResult;
  policy: Omit<PolicyVersion, 'rules'> & { rules: PolicyRules };
  payroll: PayrollRecord | null;
  history: PayrollRecord[];
  comparison: PayComparison | null;
  adjustments: Adjustment[];
}

/** Everything the Fairness Replay screen needs for one worker and one period. */
export function payView(db: Db, org: OrgRow, user: UserRow, periodId: string, now: number): PayView {
  const policy = policyFor(db, org.id, user.pay_group ?? '', periodId);
  const adjustments = adjustmentsFor(db, user.id, periodId);
  const result = replay({
    events: attendanceEvents(db, user.id),
    rules: policy.rules,
    terms: termsFor(user),
    periodId,
    timeZone: org.time_zone,
    now,
    adjustments,
  });
  const history = payrollHistory(db, user.id, periodId);
  const payroll = history[0] ?? null;
  return {
    replay: result,
    policy,
    payroll,
    history,
    comparison: payroll ? comparePay(result.expected, payroll) : null,
    adjustments,
  };
}
