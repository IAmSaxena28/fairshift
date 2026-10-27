import request from 'supertest';
import { openDatabase, type Db } from '../../src/server/db/db.ts';
import { DEMO_PASSWORD, seedDemo } from '../../src/server/db/seed.ts';
import { createApp } from '../../src/server/http/app.ts';

/** Tuesday 27 October 2026, 10:00 in India. */
export const NOW = Date.parse('2026-10-27T04:30:00Z');

export function setup(now = NOW) {
  const db: Db = openDatabase();
  seedDemo(db, now);
  const clock = { now };
  const app = createApp({ db, secret: 'test-secret-that-is-long-enough-123456', now: () => clock.now });
  const login = async (username: string) => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ username, password: DEMO_PASSWORD });
    if (res.status !== 200) throw new Error(`login ${username} failed: ${res.status}`);
    return agent;
  };
  return { db, app, clock, login };
}
