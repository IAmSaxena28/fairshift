/**
 * Confidential reporting. These routes are mounted before the session reader, so they cannot see
 * who is signed in, and the web client calls them with credentials omitted.
 */
import { Router } from 'express';
import { z } from 'zod';
import { one, type Db } from '../../db/db.ts';
import { createConfidentialReport, publicCaseStatus, reopenByCode, SAFETY_CATEGORIES } from '../../services/safety.ts';
import { listSites, type OrgRow } from '../../services/workforce.ts';
import { notFound } from '../errors.ts';
import { parse, rateLimit } from '../middleware.ts';
import { RateLimiter } from '../security.ts';
import { ReportBody } from './worker.ts';

const OrgCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/);
const TrackingCode = z.string().trim().regex(/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/);
const ReopenBody = z.object({ note: z.string().trim().min(3).max(1000) });

export function publicRoutes(db: Db, now: () => number): Router {
  const r = Router();
  const submitLimiter = new RateLimiter(5, 3_600_000);
  const lookupLimiter = new RateLimiter(30, 60_000);

  const orgByCode = (code: unknown): OrgRow => {
    const org = one<OrgRow>(db, 'SELECT * FROM orgs WHERE report_code = ?', parse(OrgCode, code));
    if (!org) throw notFound();
    return org;
  };

  r.get('/orgs/:code', (req, res) => {
    const org = orgByCode(req.params.code);
    res.json({
      name: org.name,
      sites: listSites(db, org.id).map(({ id, name, headcount }) => ({ id, name, small: headcount < org.min_group_size })),
      categories: SAFETY_CATEGORIES,
    });
  });

  r.post('/orgs/:code/reports', rateLimit(submitLimiter, now), (req, res) => {
    const org = orgByCode(req.params.code);
    const body = parse(ReportBody, req.body);
    const { trackingCode } = createConfidentialReport(db, org, { ...body, siteId: body.siteId ?? null }, now());
    // The case id is deliberately not returned: the tracking code is the only handle.
    res.status(201).json({ trackingCode });
  });

  // Wrong and malformed codes get the same 404, so the endpoint does not reveal which codes exist.
  r.get('/reports/:code', rateLimit(lookupLimiter, now), (req, res) => {
    const code = TrackingCode.safeParse(req.params.code);
    if (!code.success) throw notFound();
    res.json(publicCaseStatus(db, code.data));
  });

  r.post('/reports/:code/reopen', rateLimit(lookupLimiter, now), (req, res) => {
    const code = TrackingCode.safeParse(req.params.code);
    if (!code.success) throw notFound();
    reopenByCode(db, code.data, parse(ReopenBody, req.body).note, now());
    res.json({ ok: true });
  });

  return r;
}
