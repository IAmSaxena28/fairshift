import { Router, type Request } from 'express';
import { z } from 'zod';
import { all, insert, one, tx, type Db } from '../../db/db.ts';
import { appendAudit, canonicalJson, sha256, verifyAuditChain } from '../../domain/auditChain.ts';
import { recentSessions } from '../../services/attendance.ts';
import { correctionDetail, listCorrections, markPaid, resolveCorrection, startReview } from '../../services/corrections.ts';
import { dashboard } from '../../services/insights.ts';
import { listSafetyCases, safetyCaseDetail, transitionSafetyCase } from '../../services/safety.ts';
import { getOrg, getUser, listSites, listWorkers, payView, policyFor } from '../../services/workforce.ts';
import { addDays, localDateKey, periodOf, previousPeriod, zonedToUtc } from '../../../shared/time.ts';
import type { PolicyRules, SafetyStatus } from '../../../shared/types.ts';
import { badRequest, conflict } from '../errors.ts';
import { parse, requireRole } from '../middleware.ts';

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const IdParam = z.coerce.number().int().positive();
const DateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const ResolveBody = z.object({
  outcome: z.enum(['corrected', 'no_change']),
  note: z.string().trim().min(10, 'Explain the decision in at least 10 characters').max(1000),
  checkOutDate: DateKey.optional(),
  checkOutTime: Time.optional(),
});
const TransitionBody = z.object({
  to: z.enum(['acknowledged', 'under_review', 'action_taken', 'resolved'] satisfies SafetyStatus[]),
  note: z.string().trim().min(3).max(1000),
  public: z.boolean().default(true),
});
const ShiftBody = z.object({ userId: z.number().int().positive(), date: DateKey, start: Time, end: Time });
const Minutes = z.number().int().min(0).max(7 * 24 * 60);
const PolicyBody = z.object({
  payGroup: z.string().min(1).max(40),
  effectivePeriod: Period,
  note: z.string().trim().min(5).max(500),
  overtime: z.object({ eligible: z.boolean(), mode: z.enum(['daily', 'weekly']), thresholdMinutes: Minutes, multiplierBp: z.number().int().min(10_000).max(40_000) }),
  unpaidBreak: z.object({ afterMinutes: Minutes, minutes: z.number().int().min(0).max(120) }),
  nightAllowancePaise: z.number().int().min(0).max(1_000_000),
  fatigue: z.object({ maxShiftMinutes: Minutes, minRestMinutes: Minutes, maxWeeklyMinutes: Minutes, maxConsecutiveDays: z.number().int().min(1).max(14) }),
});

export function adminRoutes(db: Db, now: () => number): Router {
  const r = Router();
  r.use(requireRole('admin'));

  const ctx = (req: Request) => {
    const org = getOrg(db, req.session!.orgId);
    return { org, admin: getUser(db, org.id, req.session!.userId), t: now() };
  };

  r.get('/dashboard', (req, res) => {
    const { org, t } = ctx(req);
    res.json(dashboard(db, org, t));
  });

  r.get('/workers', (req, res) => {
    const { org, t } = ctx(req);
    const last = previousPeriod(periodOf(localDateKey(t, org.time_zone)));
    const sites = new Map(listSites(db, org.id).map((s) => [s.id, s.name]));
    res.json(
      listWorkers(db, org.id).map((w) => {
        const recent = recentSessions(db, org, w, t, 7);
        const pay = payView(db, org, w, last, t);
        return {
          id: w.id,
          name: w.name,
          jobTitle: w.job_title,
          site: w.site_id ? sites.get(w.site_id) ?? null : null,
          basis: w.pay_basis,
          ratePaise: w.rate_paise,
          last7DaysMinutes: recent.sessions.reduce((acc, s) => acc + s.payableMinutes, 0),
          checkedIn: recent.sessions.some((s) => s.flag === 'in_progress'),
          fatigueWarnings: recent.fatigue.length,
          missedCheckOuts: recent.missed.length,
          payStatus: pay.comparison?.status ?? null,
          payDifferencePaise: pay.comparison?.differencePaise ?? null,
        };
      }),
    );
  });

  r.get('/workers/:id', (req, res) => {
    const { org, t } = ctx(req);
    const worker = getUser(db, org.id, parse(IdParam, req.params.id));
    if (worker.role !== 'worker') throw badRequest('not_worker', 'Not a worker.');
    const recent = recentSessions(db, org, worker, t, 14);
    res.json({ worker: { id: worker.id, name: worker.name, jobTitle: worker.job_title }, ...recent });
  });

  r.get('/workers/:id/pay/:period', (req, res) => {
    const { org, t } = ctx(req);
    const worker = getUser(db, org.id, parse(IdParam, req.params.id));
    res.json({ worker: { id: worker.id, name: worker.name }, ...payView(db, org, worker, parse(Period, req.params.period), t) });
  });

  r.get('/shifts', (req, res) => {
    const { org, t } = ctx(req);
    const date = req.query.date ? parse(DateKey, req.query.date) : localDateKey(t, org.time_zone);
    res.json({
      date,
      shifts: all(
        db,
        `SELECT s.id, s.user_id AS userId, u.name AS worker, si.name AS site, s.start_at AS startAt, s.end_at AS endAt
           FROM shifts s JOIN users u ON u.id = s.user_id LEFT JOIN sites si ON si.id = s.site_id
          WHERE s.org_id = ? AND s.date = ? ORDER BY s.start_at, u.name`,
        org.id,
        date,
      ),
    });
  });

  r.post('/shifts', (req, res) => {
    const { org, admin, t } = ctx(req);
    const body = parse(ShiftBody, req.body);
    const worker = getUser(db, org.id, body.userId);
    if (worker.role !== 'worker') throw badRequest('not_worker', 'Shifts can only be assigned to workers.');
    const startAt = zonedToUtc(body.date, body.start, org.time_zone);
    const endAt = zonedToUtc(body.end > body.start ? body.date : addDays(body.date, 1), body.end, org.time_zone);
    const id = tx(db, () => {
      const overlap = one(db, 'SELECT id FROM shifts WHERE user_id = ? AND start_at < ? AND end_at > ?', worker.id, endAt, startAt);
      if (overlap) throw conflict('shift_overlap', 'This worker already has a shift at that time.');
      const shiftId = insert(
        db,
        'INSERT INTO shifts (org_id, user_id, site_id, date, start_at, end_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        org.id,
        worker.id,
        worker.site_id,
        body.date,
        startAt,
        endAt,
        admin.id,
      );
      appendAudit(db, { orgId: org.id, at: t, actorUserId: admin.id, action: 'shift.assigned', entity: 'shift', entityId: shiftId, details: { userId: worker.id, date: body.date, start: body.start, end: body.end } });
      return shiftId;
    });
    res.status(201).json({ id });
  });

  r.get('/corrections', (req, res) => {
    const { org } = ctx(req);
    res.json(listCorrections(db, org.id));
  });

  r.get('/corrections/:id', (req, res) => {
    const { org, t } = ctx(req);
    res.json(correctionDetail(db, org, parse(IdParam, req.params.id), t, false));
  });

  r.post('/corrections/:id/review', (req, res) => {
    const { org, admin, t } = ctx(req);
    startReview(db, org, admin, parse(IdParam, req.params.id), t);
    res.json({ ok: true });
  });

  r.post('/corrections/:id/resolve', (req, res) => {
    const { org, admin, t } = ctx(req);
    const body = parse(ResolveBody, req.body);
    const checkOutAt = body.checkOutDate && body.checkOutTime ? zonedToUtc(body.checkOutDate, body.checkOutTime, org.time_zone) : undefined;
    resolveCorrection(db, org, admin, parse(IdParam, req.params.id), { outcome: body.outcome, note: body.note, checkOutAt }, t);
    res.json({ ok: true });
  });

  r.post('/payroll/:id/mark-paid', (req, res) => {
    const { org, admin, t } = ctx(req);
    markPaid(db, org, admin, parse(IdParam, req.params.id), t);
    res.json({ ok: true });
  });

  r.get('/safety', (req, res) => {
    const { org, t } = ctx(req);
    res.json(listSafetyCases(db, org, t));
  });

  r.get('/safety/:id', (req, res) => {
    const { org, t } = ctx(req);
    res.json(safetyCaseDetail(db, org, parse(IdParam, req.params.id), t));
  });

  r.post('/safety/:id/transition', (req, res) => {
    const { org, admin, t } = ctx(req);
    transitionSafetyCase(db, org, admin, parse(IdParam, req.params.id), parse(TransitionBody, req.body), t);
    res.json({ ok: true });
  });

  r.get('/policy', (req, res) => {
    const { org, t } = ctx(req);
    const current = periodOf(localDateKey(t, org.time_zone));
    const groups = all<{ pay_group: string }>(db, 'SELECT DISTINCT pay_group FROM policies WHERE org_id = ?', org.id);
    res.json({
      currentPeriod: current,
      groups: groups.map(({ pay_group }) => ({
        payGroup: pay_group,
        current: policyFor(db, org.id, pay_group, current),
        versions: all(
          db,
          'SELECT version, effective_period AS effectivePeriod, hash, created_at AS createdAt FROM policies WHERE org_id = ? AND pay_group = ? ORDER BY version DESC',
          org.id,
          pay_group,
        ),
      })),
    });
  });

  // A policy change adds a version for the current or a future period. Past periods keep the rules they were paid under.
  r.post('/policy', (req, res) => {
    const { org, admin, t } = ctx(req);
    const body = parse(PolicyBody, req.body);
    const current = periodOf(localDateKey(t, org.time_zone));
    if (body.effectivePeriod < current) throw badRequest('retroactive_policy', 'A new policy can only start this month or later.');
    const base = policyFor(db, org.id, body.payGroup, current);
    const rules: PolicyRules = {
      ...base.rules,
      overtime: body.overtime,
      unpaidBreak: body.unpaidBreak,
      nightAllowancePaise: body.nightAllowancePaise,
      fatigue: body.fatigue,
    };
    const version = tx(db, () => {
      const next = (one<{ v: number }>(db, 'SELECT MAX(version) AS v FROM policies WHERE org_id = ? AND pay_group = ?', org.id, body.payGroup)?.v ?? 0) + 1;
      const hash = sha256(canonicalJson(rules));
      const id = insert(
        db,
        'INSERT INTO policies (org_id, pay_group, version, effective_period, rules_json, hash, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        org.id,
        body.payGroup,
        next,
        body.effectivePeriod,
        JSON.stringify(rules),
        hash,
        t,
        admin.id,
      );
      appendAudit(db, { orgId: org.id, at: t, actorUserId: admin.id, action: 'policy.versioned', entity: 'policy', entityId: id, details: { payGroup: body.payGroup, version: next, effectivePeriod: body.effectivePeriod, hash, note: body.note } });
      return next;
    });
    res.status(201).json({ version });
  });

  r.get('/audit', (req, res) => {
    const { org } = ctx(req);
    const limit = Math.min(200, Number(req.query.limit) || 50);
    res.json(
      all(
        db,
        `SELECT a.seq, a.at, a.action, a.entity, a.entity_id AS entityId, a.details_json AS details, a.hash, a.prev_hash AS prevHash, u.name AS actor
           FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.org_id = ? ORDER BY a.seq DESC LIMIT ?`,
        org.id,
        limit,
      ),
    );
  });

  r.get('/audit/verify', (req, res) => {
    const { org } = ctx(req);
    res.json(verifyAuditChain(db, org.id));
  });

  return r;
}
