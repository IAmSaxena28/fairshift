import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { HttpError } from './errors.ts';
import { RateLimiter, verifySession, type Session } from './security.ts';
import type { Role } from '../../shared/types.ts';

export const SESSION_COOKIE = 'fs_session';

declare module 'express-serve-static-core' {
  interface Request {
    session?: Session;
  }
}

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Only over HTTPS (Cloud Run), so local http://localhost development keeps working.
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Attaches the signed session, if any. Never mounted on the confidential reporting routes. */
export function sessionReader(secret: string, now: () => number) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = readCookie(req, SESSION_COOKIE);
    const session = token ? verifySession(token, secret, now()) : null;
    if (session) req.session = session;
    next();
  };
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.session) return next(new HttpError(401, 'unauthenticated', 'Please sign in.'));
    if (req.session.role !== role) return next(new HttpError(403, 'forbidden', 'Not allowed.'));
    next();
  };
}

/**
 * Cross-site request protection for state-changing calls: the session cookie is SameSite=Strict,
 * and a JSON body is required, which a plain HTML form on another site cannot send.
 */
export function requireJson(req: Request, _res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
    return next(new HttpError(415, 'json_required', 'Send JSON.'));
  }
  next();
}

const daySalt = { day: '', salt: '' };
/** A per-day salted hash of the client address, held only in memory, for rate limiting. */
export function clientKey(req: Request, now: number): string {
  const day = new Date(now).toISOString().slice(0, 10);
  if (daySalt.day !== day) Object.assign(daySalt, { day, salt: randomBytes(16).toString('hex') });
  return createHash('sha256').update(daySalt.salt + (req.ip ?? '')).digest('hex').slice(0, 32);
}

export function rateLimit(limiter: RateLimiter, now: () => number, scope: (req: Request) => string = () => '') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const t = now();
    if (!limiter.take(`${clientKey(req, t)}:${scope(req)}`, t)) {
      return next(new HttpError(429, 'rate_limited', 'Too many attempts. Please wait a minute.'));
    }
    next();
  };
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(400, 'invalid_input', issue ? `${issue.path.join('.') || 'input'}: ${issue.message}` : 'Invalid input');
  }
  return result.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_json', message: 'Malformed JSON.' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal', message: 'Something went wrong. Please try again.' });
}
