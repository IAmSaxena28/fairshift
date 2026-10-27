import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Db } from '../../db/db.ts';
import { checkIn, checkOut, hoursView, todayView } from '../../services/attendance.ts';
import {
  caseEvents,
  listCorrections,
  reopenCorrection,
  requestAttendanceCorrection,
  requestPayCorrection,
} from '../../services/corrections.ts';
import { createNamedReport, SAFETY_CATEGORIES, transitionSafetyCase, workerSafetyCases } from '../../services/safety.ts';
import { getOrg, getUser, listSites, payrollPeriods, payView } from '../../services/workforce.ts';
import { localDateKey, periodOf, previousPeriod, zonedToUtc } from '../../../shared/time.ts';
import type { SafetyCategory } from '../../../shared/types.ts';
import { parse, requireRole } from '../middleware.ts';

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Note = z.string().trim().max(1000);
const CorrectionBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pay'), period: Period, note: Note.optional() }),
  z.object({
    kind: z.literal('attendance'),
    checkInEventId: z.number().int().positive(),
    checkOutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checkOutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    note: Note.optional(),
  }),
]);
export const ReportBody = z.object({
  category: z.enum(SAFETY_CATEGORIES as [SafetyCategory, ...SafetyCategory[]]),
  urgent: z.boolean(),
  description: z.string().trim().min(3).max(2000),
  siteId: z.number().int().positive().nullable().optional(),
});
const ReopenBody = z.object({ note: z.string().trim().min(3).max(1000) });
const IdParam = z.coerce.number().int().positive();

export function workerRoutes(db: Db, now: () => number): Router {
  const r = Router();
  r.use(requireRole('worker'));

  const ctx = (req: Request) => {
    const org = getOrg(db, req.session!.orgId);
    return { org, user: getUser(db, org.id, req.session!.userId), t: now() };
  };

  r.get('/today', (req, res) => {
    const { org, user, t } = ctx(req);
    const today = todayView(db, org, user, t);
    const periods = payrollPeriods(db, user.id);
    const openCases =
      listCorrections(db, org.id, { userId: user.id }).filter((c) => c.status !== 'resolved').length +
      workerSafetyCases(db, user).filter((c) => c.status !== 'resolved').length;
    res.json({ ...today, latestPay: periods[0] ?? null, openCases });
  });

  r.post('/check-in', (req, res) => {
    const { org, user, t } = ctx(req);
    res.status(201).json(checkIn(db, org, user, t));
  });

  r.post('/check-out', (req, res) => {
    const { org, user, t } = ctx(req);
    res.status(201).json(checkOut(db, org, user, t));
  });

  r.get('/hours', (req, res) => {
    const { org, user, t } = ctx(req);
    const period = req.query.period ? parse(Period, req.query.period) : periodOf(localDateKey(t, org.time_zone));
    res.json(hoursView(db, org, user, period, t));
  });

  r.get('/pay', (req, res) => {
    const { org, user, t } = ctx(req);
    const current = periodOf(localDateKey(t, org.time_zone));
    res.json({ current, previous: previousPeriod(current), records: payrollPeriods(db, user.id) });
  });

  r.get('/pay/:period', (req, res) => {
    const { org, user, t } = ctx(req);
    const period = parse(Period, req.params.period);
    const correction = listCorrections(db, org.id, { userId: user.id }).find((c) => c.kind === 'pay' && c.period === period) ?? null;
    res.json({ ...payView(db, org, user, period, t), correction });
  });

  r.post('/corrections', (req, res) => {
    const { org, user, t } = ctx(req);
    const body = parse(CorrectionBody, req.body);
    if (body.kind === 'pay') {
      res.status(201).json(requestPayCorrection(db, org, user, body.period, body.note || null, t));
    } else {
      const at = zonedToUtc(body.checkOutDate, body.checkOutTime, org.time_zone);
      res.status(201).json(requestAttendanceCorrection(db, org, user, body.checkInEventId, at, body.note || null, t));
    }
  });

  r.post('/corrections/:id/reopen', (req, res) => {
    const { org, user, t } = ctx(req);
    reopenCorrection(db, org, user, parse(IdParam, req.params.id), parse(ReopenBody, req.body).note, t);
    res.json({ ok: true });
  });

  r.get('/cases', (req, res) => {
    const { org, user } = ctx(req);
    const corrections = listCorrections(db, org.id, { userId: user.id }).map((c) => ({
      id: c.id,
      kind: c.kind,
      period: c.period,
      status: c.status,
      outcome: c.outcome,
      expectedPaise: c.expected_paise,
      recordedPaise: c.recorded_paise,
      createdAt: c.created_at,
      events: caseEvents(db, 'correction', c.id, true),
    }));
    res.json({ corrections, safety: workerSafetyCases(db, user) });
  });

  r.get('/sites', (req, res) => {
    const { org } = ctx(req);
    res.json(listSites(db, org.id).map(({ id, name }) => ({ id, name })));
  });

  r.post('/safety', (req, res) => {
    const { org, user, t } = ctx(req);
    const body = parse(ReportBody, req.body);
    res.status(201).json(createNamedReport(db, org, user, { ...body, siteId: body.siteId ?? null }, t));
  });

  r.post('/safety/:id/reopen', (req, res) => {
    const { org, user, t } = ctx(req);
    const { note } = parse(ReopenBody, req.body);
    transitionSafetyCase(db, org, user, parse(IdParam, req.params.id), { to: 'under_review', note, public: true }, t);
    res.json({ ok: true });
  });

  return r;
}
