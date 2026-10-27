import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db/db.ts';
import { seedDemo } from './db/seed.ts';
import { createApp } from './http/app.ts';

const port = Number(process.env.PORT ?? 8080);
const production = process.env.NODE_ENV === 'production';

let secret = process.env.SESSION_SECRET ?? '';
if (secret.length < 32) {
  // Without a configured secret, sessions simply end when the process restarts.
  secret = randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET not set (or shorter than 32 characters); using a random per-process secret.');
}

const db = openDatabase(process.env.DATABASE_PATH ?? ':memory:');
seedDemo(db, Date.now());

const here = path.dirname(fileURLToPath(import.meta.url));
const app = createApp({
  db,
  secret,
  secureCookies: production,
  demoMode: process.env.DEMO_MODE !== 'false',
  staticDir: process.env.STATIC_DIR ?? path.resolve(here, '../../web'),
});

app.listen(port, () => {
  console.log(`FairShift listening on http://localhost:${port}`);
});
