// Prints a summary of the seeded demo so the data can be inspected without starting the server.
import { openDatabase } from '../src/server/db/db.ts';
import { seedDemo } from '../src/server/db/seed.ts';
import { dashboard } from '../src/server/services/insights.ts';
import { getOrg } from '../src/server/services/workforce.ts';

const db = openDatabase();
const now = Date.now();
seedDemo(db, now);
for (const id of [1, 2]) {
  const d = dashboard(db, getOrg(db, id), now);
  console.log(JSON.stringify({ org: d.org, workforce: d.workforce, pay: d.pay, safety: { ...d.safety, byCategory: undefined }, actions: d.actions.length, fatigue: d.hours.fatigueCounts }, null, 1));
}
