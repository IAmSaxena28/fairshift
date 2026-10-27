/**
 * Deterministic demonstration data: two fictional organisations in different industries,
 * built relative to `now` so the demo always shows last month's payroll and this month's shifts.
 * All people, places and incidents are invented.
 */
import { createHash } from 'node:crypto';
import { insert, tx, type Db } from './db.ts';
import { appendAudit, canonicalJson, sha256 } from '../domain/auditChain.ts';
import { COLLEGE_FACILITIES, CONSTRUCTION_LABOUR } from '../domain/demoPolicies.ts';
import { replay } from '../domain/payEngine.ts';
import { hashPassword, normaliseTrackingCode } from '../http/security.ts';
import { addDays, isoWeekKey, localDateKey, monthPeriod, periodOf, previousPeriod, zonedToUtc } from '../../shared/time.ts';
import type { AttendanceEvent, Industry, PolicyRules } from '../../shared/types.ts';

export const DEMO_PASSWORD = 'fairshift-demo';
const TZ = 'Asia/Kolkata';

type Shift = [start: string, end: string] | null;
/** Returns the planned shift for a date, given the weekday (0 = Sunday) and ISO week number. */
type Pattern = (weekday: number, week: number, date: string) => Shift;

interface DemoWorker {
  username: string;
  name: string;
  job: string;
  site: string;
  basis: 'hourly' | 'monthly';
  ratePaise: number;
  pattern: Pattern;
  /** Days before today on which the worker forgot to check out. */
  missedCheckOutDaysAgo?: number;
  /** Change to last month's recorded overtime, to seed a discrepancy. */
  recordedOvertimeDelta?: number;
  lastMonthAdjustment?: { amountPaise: number; reason: string };
  /** Leave today's attendance empty so the live check-in can be demonstrated. */
  demoCheckIn?: boolean;
}

interface DemoOrg {
  slug: string;
  name: string;
  industry: Industry;
  reportCode: string;
  payGroup: string;
  rules: PolicyRules;
  sites: string[];
  admin: { username: string; name: string; job: string };
  workers: DemoWorker[];
  cases: DemoCase[];
}

interface DemoCase {
  site: string;
  category: string;
  urgent: boolean;
  description: string;
  reporter?: string;
  trackingCode?: string;
  /** Status history as [status, days ago, note]. The first entry is the submission. */
  history: Array<[string, number, string | null]>;
}

const sixDays = (start: string, end: string): Pattern => (wd) => (wd === 0 ? null : [start, end]);
const weekdays = (start: string, end: string): Pattern => (wd) => (wd === 0 || wd === 6 ? null : [start, end]);

/** Rotating security pattern: day shifts on even ISO weeks, nights on odd weeks with a Sunday cover shift. */
const rotatingGuard: Pattern = (wd, week) => {
  if (week % 2 === 0) return wd === 0 ? null : ['06:00', '14:00'];
  if (wd === 0) return ['14:00', '22:00'];
  return ['22:00', '06:00'];
};

export const DEMO_ORGS: DemoOrg[] = [
  {
    slug: 'sthapati',
    name: 'Sthapati Builders (fictional)',
    industry: 'construction',
    reportCode: 'STHAPATI',
    payGroup: 'site_labour',
    rules: CONSTRUCTION_LABOUR,
    sites: ['Velachery Tower site', 'OMR Warehouse site'],
    admin: { username: 'lakshmi', name: 'Lakshmi Raman', job: 'Site supervisor' },
    workers: [
      {
        username: 'ravi',
        name: 'Ravi Kumar',
        job: 'Mason helper',
        site: 'Velachery Tower site',
        basis: 'hourly',
        ratePaise: 100_00,
        pattern: (wd) => (wd === 0 ? null : wd === 6 ? ['08:00', '13:00'] : ['08:00', '18:00']),
        recordedOvertimeDelta: -1_200_00,
        lastMonthAdjustment: { amountPaise: -500_00, reason: 'Advance repaid' },
        demoCheckIn: true,
      },
      { username: 'meena', name: 'Meena Selvi', job: 'Mason', site: 'Velachery Tower site', basis: 'hourly', ratePaise: 125_00, pattern: sixDays('08:00', '16:00') },
      { username: 'arjun', name: 'Arjun Prakash', job: 'Scaffolder', site: 'Velachery Tower site', basis: 'hourly', ratePaise: 110_00, pattern: sixDays('08:00', '17:30') },
      { username: 'suresh', name: 'Suresh Mani', job: 'Labourer', site: 'Velachery Tower site', basis: 'hourly', ratePaise: 90_00, pattern: sixDays('08:00', '16:00'), missedCheckOutDaysAgo: 3 },
      { username: 'karthik', name: 'Karthik Raja', job: 'Labourer', site: 'Velachery Tower site', basis: 'hourly', ratePaise: 90_00, pattern: sixDays('07:00', '19:30') },
      { username: 'divya', name: 'Divya Nair', job: 'Bar bender', site: 'Velachery Tower site', basis: 'hourly', ratePaise: 95_00, pattern: weekdays('08:00', '16:00') },
      { username: 'imran', name: 'Imran Khan', job: 'Labourer', site: 'Velachery Tower site', basis: 'hourly', ratePaise: 95_00, pattern: sixDays('08:00', '16:00') },
      { username: 'gopal', name: 'Gopal Das', job: 'Storekeeper', site: 'OMR Warehouse site', basis: 'hourly', ratePaise: 95_00, pattern: sixDays('09:00', '17:00') },
      { username: 'nisha', name: 'Nisha Thomas', job: 'Labourer', site: 'OMR Warehouse site', basis: 'hourly', ratePaise: 95_00, pattern: sixDays('09:00', '17:00') },
    ],
    cases: [
      {
        site: 'Velachery Tower site',
        category: 'ppe',
        urgent: false,
        description: 'New workers at the tower site were not given helmets on their first day.',
        reporter: 'arjun',
        history: [
          ['submitted', 20, null],
          ['acknowledged', 20, 'Checking the store issue register.'],
          ['under_review', 19, 'Store had run out of helmets.'],
          ['action_taken', 19, '40 helmets bought; induction checklist now includes PPE issue.'],
          ['resolved', 18, 'Confirmed every worker on site has a helmet.'],
        ],
      },
      {
        site: 'Velachery Tower site',
        category: 'hazard',
        urgent: true,
        description: 'Exposed wiring near the lift shaft on floor 3. Water collects there when it rains.',
        trackingCode: 'DEMO-CNST-0001',
        history: [
          ['submitted', 12, null],
          ['acknowledged', 12, 'Area closed off with tape.'],
          ['under_review', 12, null],
          ['action_taken', 11, 'Electrician rerouted and covered the wiring.'],
          ['resolved', 11, 'Safety officer inspected floor 3 and signed off.'],
        ],
      },
      {
        site: 'OMR Warehouse site',
        category: 'other',
        urgent: false,
        description: 'Drinking water runs out by 2 pm most days.',
        trackingCode: 'DEMO-CNST-0002',
        history: [
          ['submitted', 6, null],
          ['under_review', 5, null],
          ['action_taken', 5, 'Second water can ordered for afternoons from next week.'],
        ],
      },
      {
        site: 'Velachery Tower site',
        category: 'wages',
        urgent: false,
        description: 'Sunday work two weeks ago is not shown in my hours.',
        reporter: 'meena',
        history: [
          ['submitted', 3, null],
          ['under_review', 2, 'Checking the gate register for that Sunday.'],
        ],
      },
    ],
  },
  {
    slug: 'greenfield',
    name: 'Greenfield College of Engineering (fictional)',
    industry: 'college',
    reportCode: 'GREENFIELD',
    payGroup: 'facilities',
    rules: COLLEGE_FACILITIES,
    sites: ['Security', 'Housekeeping', 'Maintenance'],
    admin: { username: 'anita', name: 'Dr. Anita Rao', job: 'Facilities manager' },
    workers: [
      { username: 'selvam', name: 'Selvam Kannan', job: 'Security guard', site: 'Security', basis: 'monthly', ratePaise: 18_000_00, pattern: rotatingGuard, demoCheckIn: true },
      { username: 'joseph', name: 'Joseph Antony', job: 'Security guard', site: 'Security', basis: 'monthly', ratePaise: 17_500_00, pattern: weekdays('22:00', '06:00') },
      { username: 'anand', name: 'Anand Verma', job: 'Security guard', site: 'Security', basis: 'monthly', ratePaise: 17_500_00, pattern: sixDays('06:00', '14:00') },
      { username: 'rekha', name: 'Rekha Pillai', job: 'Security guard', site: 'Security', basis: 'monthly', ratePaise: 17_500_00, pattern: sixDays('14:00', '22:00') },
      { username: 'mohan', name: 'Mohan Lal', job: 'Security supervisor', site: 'Security', basis: 'monthly', ratePaise: 21_000_00, pattern: sixDays('09:00', '17:00') },
      { username: 'priya', name: 'Priya Devi', job: 'Housekeeping staff', site: 'Housekeeping', basis: 'monthly', ratePaise: 15_000_00, pattern: sixDays('07:00', '15:00') },
      { username: 'gita', name: 'Gita Kumari', job: 'Housekeeping staff', site: 'Housekeeping', basis: 'monthly', ratePaise: 15_000_00, pattern: sixDays('07:00', '15:00') },
      { username: 'mary', name: 'Mary Joseph', job: 'Housekeeping staff', site: 'Housekeeping', basis: 'monthly', ratePaise: 15_000_00, pattern: sixDays('07:00', '15:00') },
      { username: 'bala', name: 'Bala Murugan', job: 'Housekeeping staff', site: 'Housekeeping', basis: 'monthly', ratePaise: 15_000_00, pattern: sixDays('07:00', '15:00') },
      { username: 'sunita', name: 'Sunita Yadav', job: 'Housekeeping lead', site: 'Housekeeping', basis: 'monthly', ratePaise: 16_500_00, pattern: sixDays('07:00', '15:00') },
      { username: 'farhan', name: 'Farhan Ali', job: 'Electrician', site: 'Maintenance', basis: 'monthly', ratePaise: 22_000_00, pattern: sixDays('09:00', '17:00') },
      { username: 'ramesh', name: 'Ramesh Babu', job: 'Plumber', site: 'Maintenance', basis: 'monthly', ratePaise: 21_000_00, pattern: sixDays('09:00', '17:00') },
    ],
    cases: [
      {
        site: 'Housekeeping',
        category: 'ppe',
        urgent: false,
        description: 'Cleaning chemicals in hostel block B are issued without gloves.',
        trackingCode: 'DEMO-CLGE-0001',
        history: [
          ['submitted', 6, null],
          ['acknowledged', 5, 'Thank you. We are checking the supply for block B.'],
          ['under_review', 4, null],
        ],
      },
      {
        site: 'Security',
        category: 'workload',
        urgent: false,
        description: 'Night guards have no relief guard, so nobody can take a break.',
        trackingCode: 'DEMO-CLGE-0002',
        history: [['submitted', 1, null]],
      },
      {
        site: 'Maintenance',
        category: 'equipment',
        urgent: false,
        description: 'The tall ladder in the maintenance store has a cracked rung.',
        reporter: 'farhan',
        history: [
          ['submitted', 9, null],
          ['acknowledged', 9, 'Ladder tagged out of use.'],
          ['under_review', 8, null],
          ['action_taken', 8, 'Replacement ladder delivered.'],
          ['resolved', 7, 'Old ladder disposed of.'],
        ],
      },
      {
        site: 'Security',
        category: 'equipment',
        urgent: false,
        description: 'The lock on the hostel side gate is broken.',
        reporter: 'joseph',
        history: [
          ['submitted', 2, null],
          ['acknowledged', 2, 'Locksmith booked.'],
        ],
      },
    ],
  },
];

function weekNumber(date: string): number {
  return Number(isoWeekKey(date).split('-W')[1]);
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Loads the demo organisations into an empty database. */
export function seedDemo(db: Db, now: number): void {
  const passwordHash = hashPassword(DEMO_PASSWORD);
  tx(db, () => {
    for (const o of DEMO_ORGS) seedOrg(db, o, now, passwordHash);
  });
}

function seedOrg(db: Db, o: DemoOrg, now: number, passwordHash: string): void {
  const today = localDateKey(now, TZ);
  const lastPeriod = previousPeriod(periodOf(today));
  const firstDay = monthPeriod(lastPeriod).start;
  const orgId = insert(
    db,
    'INSERT INTO orgs (slug, name, industry, time_zone, report_code, min_group_size, urgent_ack_hours) VALUES (?, ?, ?, ?, ?, 5, 4)',
    o.slug,
    o.name,
    o.industry,
    TZ,
    o.reportCode,
  );
  const siteIds = new Map(o.sites.map((name) => [name, insert(db, 'INSERT INTO sites (org_id, name) VALUES (?, ?)', orgId, name)]));
  const policyId = insert(
    db,
    'INSERT INTO policies (org_id, pay_group, version, effective_period, rules_json, hash, created_at) VALUES (?, ?, 1, ?, ?, ?, ?)',
    orgId,
    o.payGroup,
    '2000-01',
    JSON.stringify(o.rules),
    sha256(canonicalJson(o.rules)),
    now,
  );
  const adminId = insert(
    db,
    "INSERT INTO users (org_id, role, username, password_hash, name, job_title) VALUES (?, 'admin', ?, ?, ?, ?)",
    orgId,
    o.admin.username,
    passwordHash,
    o.admin.name,
    o.admin.job,
  );
  appendAudit(db, { orgId, at: now, actorUserId: null, action: 'seed.loaded', entity: 'org', entityId: orgId, details: { note: 'Fictional demonstration data', policyId } });

  const userIds = new Map<string, number>();
  for (const w of o.workers) {
    const userId = insert(
      db,
      `INSERT INTO users (org_id, site_id, role, username, password_hash, name, job_title, pay_group, pay_basis, rate_paise, employed_from)
       VALUES (?, ?, 'worker', ?, ?, ?, ?, ?, ?, ?, ?)`,
      orgId,
      siteIds.get(w.site)!,
      w.username,
      passwordHash,
      w.name,
      w.job,
      o.payGroup,
      w.basis,
      w.ratePaise,
      '2024-06-01',
    );
    userIds.set(w.username, userId);
    const events = seedShifts(db, orgId, userId, siteIds.get(w.site)!, adminId, w, firstDay, today, now);

    if (w.lastMonthAdjustment) {
      insert(
        db,
        'INSERT INTO adjustments (org_id, user_id, period, amount_paise, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        orgId,
        userId,
        lastPeriod,
        w.lastMonthAdjustment.amountPaise,
        w.lastMonthAdjustment.reason,
        adminId,
        now,
      );
    }

    // Last month's payroll as the employer's system recorded it.
    const expected = replay({
      events,
      rules: o.rules,
      terms: { basis: w.basis, ratePaise: w.ratePaise, employedFrom: '2024-06-01' },
      periodId: lastPeriod,
      timeZone: TZ,
      now,
      adjustments: w.lastMonthAdjustment ? [{ id: 0, ...w.lastMonthAdjustment }] : [],
    }).expected;
    const overtime = expected.overtimePaise + (w.recordedOvertimeDelta ?? 0);
    const gross = expected.basePaise + overtime + expected.nightAllowancePaise + expected.adjustmentsPaise;
    const payrollId = insert(
      db,
      `INSERT INTO payroll_records (org_id, user_id, period, version, base_paise, overtime_paise, night_allowance_paise,
         adjustments_paise, gross_paise, status, note, created_by, created_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 'paid', 'Imported from monthly payroll sheet', ?, ?)`,
      orgId,
      userId,
      lastPeriod,
      expected.basePaise,
      overtime,
      expected.nightAllowancePaise,
      expected.adjustmentsPaise,
      gross,
      adminId,
      now,
    );
    appendAudit(db, { orgId, at: now, actorUserId: adminId, action: 'payroll.imported', entity: 'payroll_record', entityId: payrollId, details: { userId, period: lastPeriod, grossPaise: gross } });
  }

  for (const c of o.cases) seedCase(db, orgId, siteIds.get(c.site)!, c, c.reporter ? userIds.get(c.reporter)! : null, adminId, today);
}

function seedShifts(
  db: Db,
  orgId: number,
  userId: number,
  siteId: number,
  adminId: number,
  w: DemoWorker,
  firstDay: string,
  today: string,
  now: number,
): AttendanceEvent[] {
  const events: AttendanceEvent[] = [];
  const addEvent = (kind: 'check_in' | 'check_out', at: number) => {
    const id = insert(
      db,
      `INSERT INTO attendance_events (org_id, user_id, kind, at, source, recorded_at) VALUES (?, ?, ?, ?, 'seed', ?)`,
      orgId,
      userId,
      kind,
      at,
      at,
    );
    events.push({ id, kind, at, source: 'seed' });
  };
  const missedDate = w.missedCheckOutDaysAgo ? addDays(today, -w.missedCheckOutDaysAgo) : null;

  for (let date = firstDay; date <= addDays(today, 6); date = addDays(date, 1)) {
    const shift = w.pattern(weekday(date), weekNumber(date), date);
    if (!shift) continue;
    const [start, end] = shift;
    const startAt = zonedToUtc(date, start, TZ);
    const endAt = zonedToUtc(end > start ? date : addDays(date, 1), end, TZ);
    insert(db, 'INSERT INTO shifts (org_id, user_id, site_id, date, start_at, end_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', orgId, userId, siteId, date, startAt, endAt, adminId);

    if (endAt <= now) {
      // Recorded times vary by a few minutes, deterministically, like real gate records.
      const jitter = (n: number) => (createHash('sha256').update(`${userId}:${date}:${n}`).digest()[0]! % 7) * 60_000;
      addEvent('check_in', startAt - jitter(1));
      if (date !== missedDate) addEvent('check_out', endAt + jitter(2));
    } else if (startAt <= now && date === today && !w.demoCheckIn) {
      addEvent('check_in', startAt);
    }
  }
  return events;
}

function seedCase(db: Db, orgId: number, siteId: number, c: DemoCase, reporterId: number | null, adminId: number, today: string): void {
  const at = (daysAgo: number, hour: string) => zonedToUtc(addDays(today, -daysAgo), hour, TZ);
  const [, submittedDaysAgo] = c.history[0]!;
  const createdOn = addDays(today, -submittedDaysAgo);
  const last = c.history.at(-1)!;
  const ack = c.history.find(([s]) => s === 'acknowledged' || s === 'under_review');
  const resolved = last[0] === 'resolved' ? at(last[1], '17:00') : null;
  const confidential = !!c.trackingCode;
  const caseId = insert(
    db,
    `INSERT INTO safety_cases (org_id, site_id, reporter_user_id, confidential, tracking_hash, category, urgent, description, status,
       created_on, created_at, acknowledged_at, resolved_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    orgId,
    siteId,
    reporterId,
    confidential ? 1 : 0,
    confidential ? sha256(normaliseTrackingCode(c.trackingCode!)) : null,
    c.category,
    c.urgent ? 1 : 0,
    c.description,
    last[0],
    createdOn,
    confidential ? null : at(submittedDaysAgo, '09:00'),
    ack ? at(ack[1], '11:00') : null,
    resolved,
    at(last[1], '17:00'),
  );
  let prev: string | null = null;
  c.history.forEach(([status, daysAgo, note], i) => {
    const isSubmission = i === 0;
    insert(
      db,
      `INSERT INTO case_events (org_id, case_type, case_id, from_status, to_status, note, public, actor_user_id, actor_role, at)
       VALUES (?, 'safety', ?, ?, ?, ?, 1, ?, ?, ?)`,
      orgId,
      caseId,
      prev,
      status,
      note,
      isSubmission ? reporterId : adminId,
      isSubmission ? (confidential ? 'reporter' : 'worker') : 'admin',
      isSubmission && confidential ? zonedToUtc(createdOn, '00:00', TZ) : at(daysAgo, `${String(9 + i * 2).padStart(2, '0')}:00`),
    );
    prev = status;
  });
}
