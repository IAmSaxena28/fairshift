import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/db.ts';
import { errorHandler, requireJson, securityHeaders, sessionReader } from './middleware.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { publicRoutes } from './routes/public.ts';
import { workerRoutes } from './routes/worker.ts';

export interface AppOptions {
  db: Db;
  secret: string;
  now?: () => number;
  secureCookies?: boolean;
  demoMode?: boolean;
  /** Directory of the built web client, served with an index.html fallback. */
  staticDir?: string;
}

export function createApp(opts: AppOptions) {
  const now = opts.now ?? Date.now;
  const app = express();
  app.disable('x-powered-by');
  // Cloud Run puts exactly one Google front end in front of the container; trusting more would let
  // a client pick its own IP through X-Forwarded-For and dodge the rate limits.
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use('/api', express.json({ limit: '32kb' }), requireJson);
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Confidential reporting is registered before the session reader on purpose.
  app.use('/api/public', publicRoutes(opts.db, now));

  app.use('/api', sessionReader(opts.secret, now));
  app.use('/api', authRoutes(opts.db, { secret: opts.secret, now, secureCookies: opts.secureCookies ?? false, demoMode: opts.demoMode ?? true }));
  app.use('/api/worker', workerRoutes(opts.db, now));
  app.use('/api/admin', adminRoutes(opts.db, now));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Not found' });
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    const dir = opts.staticDir;
    app.use(express.static(dir, { index: false, maxAge: '1h', setHeaders: (res, file) => {
      if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
