# Security and privacy

This document states what FairShift protects, how, and where the protection stops. Each claim points to the code or test that backs it.

## Confidential reports

A worker can report a safety problem or grievance with "Keep my name out". This is what the system does and does not do.

**What is stored** ([src/server/services/safety.ts](../src/server/services/safety.ts), `createConfidentialReport`):

- Organisation, category, the "someone could get hurt now" flag, the worker's description, the site they chose (or none), and the **date** in the organisation's time zone.
- The SHA-256 hash of a tracking code. The code itself is shown once to the reporter and never stored.

**What is not stored:**

- No user id, no account, no session. The report routes (`/api/public/*`) are mounted before the session middleware, so a cookie would be ignored even if one arrived, and the web client sends these requests with `credentials: 'omit'` so the browser does not send one ([src/server/http/app.ts](../src/server/http/app.ts), [src/web/api.ts](../src/web/api.ts)).
- No exact time. `created_at` is `NULL`; only `created_on` (a date) is kept, and the case history and audit entries are stamped at local midnight of that day.
- No IP address. Rate limiting uses a salted hash of the IP held in memory, and the salt changes every day.

The database refuses a confidential row that has a reporter id, an exact time or no tracking hash (`CHECK` constraint in [src/server/db/schema.ts](../src/server/db/schema.ts)). The test `stores no identity, gives a tracking code, and shows the employer response to the code holder` in [tests/api/privacyAndSecurity.test.ts](../tests/api/privacyAndSecurity.test.ts) checks the stored row and the audit entry directly.

**Small groups.** If a site has fewer than five workers (configurable per organisation), the employer console shows "Site withheld" for confidential reports from it, because naming the site would come close to naming the person. The report form tells the worker this before they choose. Tested in `does not name a small site on a confidential report`.

**Tracking codes** are 12 characters from a 30-character alphabet without look-alike characters (about 59 bits of randomness), generated with `crypto.randomInt`. Wrong and malformed codes get the same "not found" answer, and lookups are limited to 30 a minute per client. Tested in `answers wrong and malformed tracking codes identically`.

**Urgent reports and the clock.** Because a confidential report has no exact time, its acknowledgement deadline is counted from the start of the day it was sent. Urgent confidential reports therefore show as overdue earlier than named ones, never later.

**What the code holder sees:** status, category, date, and the notes the employer marked as public. Internal employer notes are not shown.

**Limits, stated to the worker on screen:**

- The description can identify the reporter ("the only woman on the night shift"). The app warns about this after a confidential report.
- On a small team, timing and context can let an employer guess, even with the site withheld.
- The hosting platform (Google Cloud Run) keeps its own request logs, which include IP addresses and times. FairShift does not control those logs. An organisation using FairShift for real should set a short log retention period and restrict who can read logs.
- A worker who loses the code cannot recover the report, by design.

FairShift never calls these reports "anonymous". The interface uses "Keep my name out" and explains what that means.

## Accounts and sessions

| Control | Where |
| --- | --- |
| Passwords hashed with scrypt and a per-user random salt, compared in constant time | [src/server/http/security.ts](../src/server/http/security.ts) |
| Same error for unknown username and wrong password | `auth.ts`; test `gives the same answer for an unknown user and a wrong password, and rate-limits guessing` |
| Sign-in limited to 10 attempts a minute per client and username | `auth.ts`, same test |
| Session cookie signed with HMAC-SHA256, checked in constant time, `httpOnly`, `SameSite=Strict`, `Secure` in production, 12-hour expiry | `security.ts`, `auth.ts`; test `rejects a tampered session cookie` |
| `SESSION_SECRET` comes from the environment (Secret Manager on Cloud Run). If it is missing, a random one is generated per process; the repository contains none | [src/server/index.ts](../src/server/index.ts), [.env.example](../.env.example) |

## Authorisation

- Two roles: `worker` and `admin`. Every worker route reads only the signed-in worker's own records; every admin route is limited to the admin's organisation. Each service query includes `org_id`.
- Test `rejects anonymous, wrong-role and cross-organisation access` checks that a worker cannot open admin routes, an admin cannot read another organisation's worker, and anonymous calls get 401.

## Request handling

- All input is validated with zod schemas before reaching a service (types, lengths, enumerations, date formats).
- Request bodies are limited to 32 KB.
- Mutating API calls must be `application/json`, otherwise 415. With `SameSite=Strict` cookies, this blocks cross-site form submissions.
- Errors return a short code and message. Stack traces are never sent to the client.

## Response headers

Set on every response ([src/server/http/middleware.ts](../src/server/http/middleware.ts), tested in `requires JSON for state changes and sets security headers`):

- `Content-Security-Policy`: `default-src 'self'`, scripts only from the same origin, no framing, no `<base>` changes, forms only to the same origin.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`.
- `Permissions-Policy` turns off camera, microphone and location.
- `Strict-Transport-Security` when served over HTTPS.
- `X-Powered-By` is removed.

## Integrity of records

- **Attendance** is append-only. A correction adds a `void` event and a new event; nothing is updated in place.
- **Payroll** is versioned. A correction inserts a new version that supersedes the old one; the old one stays visible to the worker.
- **Pay rules** are versioned and cannot be back-dated.
- **Audit log** is a per-organisation SHA-256 hash chain. The test `detects a row edited directly in the database` edits a row with SQL and checks that verification reports the exact broken position. A person with full database access could rebuild the whole chain, so the head hash should be published outside the operator's control in a real deployment (see [ARCHITECTURE.md](ARCHITECTURE.md#audit-chain)).

## What FairShift does not collect

- No location, GPS, photos, biometrics or device fingerprints. Check-in is a button press by a signed-in worker.
- No worker scores, rankings or productivity ratings. Rest and working-time warnings are dated facts shown to both the worker and the employer.
- No analytics or third-party scripts. The page loads only its own files.
- The only browser storage is the chosen language.

## Dependencies

- Runtime dependencies: `express`, `react`, `react-dom`, `zod`. Database access uses Node's built-in `node:sqlite`.
- `npm audit` reported 0 known vulnerabilities on 27 October 2026. CI runs `npm audit --omit=dev` on every push.

## Known gaps before real use

- The demo accounts and their shared password are public by design. Set `DEMO_MODE=false` and create real accounts for any real use.
- There is no password reset, account lockout notification or two-factor sign-in.
- Rate limits live in memory and reset when the container restarts; with more than one instance they would need a shared store.
- The data is not encrypted at the application level; it relies on the platform's disk encryption.
- No independent security review or penetration test has been done.
