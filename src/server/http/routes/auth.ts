import { Router } from 'express';
import { z } from 'zod';
import { all, one, run, type Db } from '../../db/db.ts';
import { DEMO_PASSWORD } from '../../db/seed.ts';
import { getOrg, getUser, listSites } from '../../services/workforce.ts';
import { HttpError } from '../errors.ts';
import { parse, rateLimit, SESSION_COOKIE } from '../middleware.ts';
import { RateLimiter, signSession, verifyPassword } from '../security.ts';
import type { Role } from '../../../shared/types.ts';

const SESSION_HOURS = 12;
const LoginBody = z.object({ username: z.string().trim().toLowerCase().min(1).max(64), password: z.string().min(1).max(200) });
const PrefsBody = z.object({ lang: z.enum(['en', 'ta', 'hi']) });

export function authRoutes(db: Db, opts: { secret: string; now: () => number; secureCookies: boolean; demoMode: boolean }): Router {
  const r = Router();
  const loginLimiter = new RateLimiter(10, 60_000);

  r.post('/auth/login', rateLimit(loginLimiter, opts.now), (req, res) => {
    const body = parse(LoginBody, req.body);
    const row = one<{ id: number; org_id: number; role: Role; password_hash: string }>(
      db,
      'SELECT id, org_id, role, password_hash FROM users WHERE username = ?',
      body.username,
    );
    // Same response whether the username or the password was wrong.
    if (!row || !verifyPassword(body.password, row.password_hash)) {
      throw new HttpError(401, 'invalid_credentials', 'Wrong username or password.');
    }
    const token = signSession({ userId: row.id, orgId: row.org_id, role: row.role, exp: opts.now() + SESSION_HOURS * 3_600_000 }, opts.secret);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: opts.secureCookies,
      maxAge: SESSION_HOURS * 3_600_000,
      path: '/',
    });
    res.json({ role: row.role });
  });

  r.post('/auth/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    if (!req.session) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
    const { orgId, userId } = req.session;
    const user = getUser(db, orgId, userId);
    const org = getOrg(db, orgId);
    const site = user.site_id ? listSites(db, orgId).find((s) => s.id === user.site_id) : undefined;
    res.json({
      user: { id: user.id, name: user.name, role: user.role, jobTitle: user.job_title, lang: user.lang, site: site?.name ?? null },
      org: { name: org.name, industry: org.industry, timeZone: org.time_zone, reportCode: org.report_code },
    });
  });

  r.put('/me/preferences', (req, res) => {
    if (!req.session) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
    const body = parse(PrefsBody, req.body);
    run(db, 'UPDATE users SET lang = ? WHERE id = ? AND org_id = ?', body.lang, req.session.userId, req.session.orgId);
    res.json({ ok: true });
  });

  // Demo accounts are listed on the sign-in page so reviewers can try every role. Disable with DEMO_MODE=false.
  r.get('/demo/accounts', (_req, res) => {
    if (!opts.demoMode) throw new HttpError(404, 'not_found', 'Not found');
    const rows = all<{ username: string; name: string; job_title: string; role: Role; org: string; industry: string }>(
      db,
      `SELECT u.username, u.name, u.job_title, u.role, o.name AS org, o.industry FROM users u JOIN orgs o ON o.id = u.org_id
        WHERE u.username IN ('ravi', 'suresh', 'lakshmi', 'selvam', 'priya', 'anita') ORDER BY o.id, u.role DESC, u.id`,
    );
    res.json({ password: DEMO_PASSWORD, accounts: rows });
  });

  return r;
}
