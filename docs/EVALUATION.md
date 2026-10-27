# Evaluation

What was tested, how, and the results. Every number here comes from a command in this repository, run on 27 October 2026.

## Summary

| Check | Command | Result |
| --- | --- | --- |
| Unit and API tests | `npm test` | 42 passed, 0 failed |
| Browser journeys and accessibility | `npm run test:e2e` | 19 passed, 0 failed |
| Type checking (client and server, strict) | `npm run typecheck` | No errors |
| Known vulnerabilities | `npm audit` | 0 (all dependencies, including dev) |
| Client bundle | `npm run build` | 74 KB JavaScript and 4 KB CSS, gzipped |

## A worked pay example

This is the seeded September case for Ravi Kumar (construction, ₹100 an hour, overtime beyond 8 hours a day at 2×, 30-minute unpaid break on shifts over 5 hours). It can be checked by hand and is what the Fairness Replay screen shows.

| Step | Calculation | Result |
| --- | --- | --- |
| Recorded time | 26 completed shifts, check-in to check-out | 242 h 18 min |
| Unpaid breaks | 26 shifts × 30 min | 13 h |
| Payable time | 242 h 18 min − 13 h | 229 h 18 min |
| Overtime split | Payable minutes beyond 8 h on each day | 34 h 54 min overtime, 194 h 24 min ordinary |
| Base pay | 194.4 h × ₹100 | ₹19,440.00 |
| Overtime pay | 34.9 h × ₹100 × 2 | ₹6,980.00 |
| Adjustments | "Advance repaid" | −₹500.00 |
| Expected gross | 19,440 + 6,980 − 500 | **₹25,920.00** |
| Payroll recorded | Overtime recorded as ₹5,780.00 | ₹24,720.00 |
| Verdict | Difference in overtime pay | **Underpaid ₹1,200.00** |

## Calculation cases

Pure engine tests in [tests/unit/payEngine.test.ts](../tests/unit/payEngine.test.ts), each with exact expected values in paise and minutes:

| Case | What it proves |
| --- | --- |
| A 10-hour day | Break, overtime and pay for one day, step by step |
| Overtime to the minute | Only minutes beyond the threshold count |
| Two shifts on one day | The daily threshold applies across both |
| Rounding | Money is rounded once per component, half away from zero |
| Adjustments | Authorised additions and deductions reach the gross |
| Overnight shift | Belongs to the start day and earns the night allowance |
| Time zone | The organisation's zone, not UTC, decides the day |
| Missed check-out | Excluded from pay and reported |
| Shift still open | Treated as in progress within the limit, not missed |
| Duplicate check-in and orphan check-out | Ignored and reported |
| Voided event | A correction replaces a wrong check-out |
| Weekly overtime across a month boundary | One ISO week, counted once |
| Joined mid-month | Salary prorated by days employed |
| Month still running | Salary counted only up to today |
| comparePay | Classifies match, underpaid or overpaid and names the component |
| Forgotten check-out then next day's check-in | The old shift is closed as missed and the new one kept |

Supporting tests in [tests/unit/fatigueAndTime.test.ts](../tests/unit/fatigueAndTime.test.ts) cover money formatting and rounding, IST and daylight-saving conversions, leap-year month periods, and each rest and working-time fact.

## API journeys

[tests/api/fairnessReplay.test.ts](../tests/api/fairnessReplay.test.ts) and [tests/api/privacyAndSecurity.test.ts](../tests/api/privacyAndSecurity.test.ts) drive the real Express app against an in-memory database with a fixed clock:

- **Journey A**: detect the seeded gap, raise a correction (a duplicate is refused), review, correct, check that version 1 is kept and version 2 matches, refuse a "no change" without a written reason, reopen.
- **College**: the same engine with monthly salary, weekly overtime and night allowance.
- **Attendance**: check in, duplicate refused, check out; a missed check-out fixed through an approved correction; overlapping shifts refused.
- **Pay rules**: a new version applies from this month and does not change last month; back-dating is refused.
- **Journey B**: a confidential report stores no user id or exact time (checked in the database row and the audit entry), the employer cannot skip states, internal notes stay internal, the code holder sees public notes and can reopen.
- **Security**: wrong and malformed codes look the same; small sites are withheld; anonymous, wrong-role and cross-organisation access are refused; a tampered cookie is rejected; login errors are uniform and rate-limited; non-JSON mutations get 415; security headers are present; a row edited in the database breaks the audit chain at the right place.

## Browser journeys

[tests/e2e/journeys.spec.ts](../tests/e2e/journeys.spec.ts) runs the built app in Chromium:

- **Journey A** (construction): Ravi sees the shortfall and asks for a check → Lakshmi reviews and corrects → Ravi sees the corrected result and both versions → the audit chain verifies.
- **Journey B** (college): Priya files a confidential report and gets a code → Anita sees "Confidential" without Priya's name and responds → the code holder reads the response on `/track` without signing in.
- **Journey C** (inclusion): Selvam checks in and files an urgent danger report in Hindi without typing; the pay explanation renders in Tamil; Suresh fixes a missed check-out from the phone; a report is filed using only the keyboard; the confidential form warns before naming a small site; a worker's language choice carries over to a new phone.

## Accessibility

[tests/e2e/accessibility.spec.ts](../tests/e2e/accessibility.spec.ts) runs axe-core with the WCAG 2.0 and 2.1 A and AA rule sets and fails on any serious or critical violation:

- Worker screens (Today, Hours, Pay, Help) in **English, Tamil and Hindi** at 360 × 740 px, also asserting there is no horizontal scrolling.
- Sign-in, the public report form and the tracking page.
- Every employer console page.
- Worker and employer screens again with the browser in dark mode, so the dark colour set is checked for contrast too.

Built in, beyond what axe checks:

- 48 px minimum touch targets; a visible focus ring on every control.
- Light and dark colour sets are both checked for AA contrast by the tests above.
- Every report category is a real radio input with a visible label and an icon; the form can be completed without typing for urgent dangers.
- `lang` on the page follows the chosen language, so screen readers switch voice.
- Status changes are announced with `role="status"` or `role="alert"`.
- Charts on the employer overview are HTML bars with the number written next to each, not colour alone.
- Read-aloud of the pay explanation, which says plainly if the device has no voice for the language.

Not yet done: testing with screen-reader users, with workers who have low literacy, or with native Tamil and Hindi speakers.

## Response times

Measured on the development container with the seeded data: 50 sequential requests to a running production build, after one warm-up request.

| Endpoint | p50 | p95 |
| --- | --- | --- |
| `GET /api/worker/pay` (full replay of a month, with history and comparison) | 1.2 ms | 2.4 ms |
| `GET /api/admin/dashboard` (replays every worker in the organisation) | 17.3 ms | 21.6 ms |
| `GET /api/admin/audit/verify` (recomputes the hash chain) | 1.1 ms | 1.4 ms |

These are server-side times on one machine with demo-sized data, not a load test.

## Self-review against the brief

| Question | Honest answer |
| --- | --- |
| Does it solve a real worker problem? | It targets two: pay that workers cannot check, and concerns that are not raised or not answered. It has not been tried with real workers. |
| Can it harm workers? | It collects no location or biometrics and does not score anyone. Confidential reports can still be guessed from content or a small team; this is stated on screen. |
| Is the pay maths trustworthy? | Integer money, exact unit tests, and the screen renders the engine's own trace. The rules are demo values, not law. |
| Are two industries real or cosmetic? | Different pay bases, overtime modes, allowances and units, through one engine, tested in both. |
| Are Tamil and Hindi usable? | Complete and tested for layout and accessibility, but drafted with AI assistance and not yet reviewed by native speakers. |
| Is it deployable? | Yes, as a single container on Cloud Run. Data is in memory and resets on restart, which suits a demo, not production. |
