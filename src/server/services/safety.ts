/**
 * Safety and grievance cases.
 *
 * Named reports are linked to the worker who filed them. Confidential reports are filed through a
 * public endpoint that never reads the session: the row stores no reporter, no IP and only the
 * calendar date, and the reporter follows it with a random tracking code that is stored only as a hash.
 */
import { all, insert, one, run, tx, type Db } from '../db/db.ts';
import { conflict, notFound } from '../http/errors.ts';
import { appendAudit, sha256 } from '../domain/auditChain.ts';
import { newTrackingCode, normaliseTrackingCode } from '../http/security.ts';
import { localDateKey, zonedToUtc } from '../../shared/time.ts';
import type { SafetyCategory, SafetyStatus } from '../../shared/types.ts';
import { addCaseEvent, caseEvents } from './corrections.ts';
import { listSites, type OrgRow, type UserRow } from './workforce.ts';

export const SAFETY_CATEGORIES: readonly SafetyCategory[] = ['hazard', 'equipment', 'ppe', 'workload', 'wages', 'mistreatment', 'other'];

/** Allowed moves. Resolving requires that an action was recorded first. */
export const SAFETY_TRANSITIONS: Record<SafetyStatus, readonly SafetyStatus[]> = {
  submitted: ['acknowledged', 'under_review'],
  acknowledged: ['under_review'],
  under_review: ['action_taken'],
  action_taken: ['resolved', 'under_review'],
  resolved: ['under_review'],
};

export interface NewReport {
  siteId: number | null;
  category: SafetyCategory;
  urgent: boolean;
  description: string;
}

interface SafetyRow {
  id: number;
  org_id: number;
  site_id: number | null;
  reporter_user_id: number | null;
  confidential: number;
  category: SafetyCategory;
  urgent: number;
  description: string;
  status: SafetyStatus;
  created_on: string;
  created_at: number | null;
  acknowledged_at: number | null;
  resolved_at: number | null;
  updated_at: number;
}

function assertSite(db: Db, orgId: number, siteId: number | null): void {
  if (siteId === null) return;
  if (!one(db, 'SELECT id FROM sites WHERE id = ? AND org_id = ?', siteId, orgId)) throw notFound();
}

export function createNamedReport(db: Db, org: OrgRow, user: UserRow, input: NewReport, now: number) {
  return tx(db, () => {
    assertSite(db, org.id, input.siteId);
    const id = insert(
      db,
      `INSERT INTO safety_cases (org_id, site_id, reporter_user_id, confidential, category, urgent, description, status, created_on, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?, 'submitted', ?, ?, ?)`,
      org.id,
      input.siteId ?? user.site_id,
      user.id,
      input.category,
      input.urgent ? 1 : 0,
      input.description,
      localDateKey(now, org.time_zone),
      now,
      now,
    );
    addCaseEvent(db, { orgId: org.id, caseType: 'safety', caseId: id, from: null, to: 'submitted', note: null, actorUserId: user.id, actorRole: 'worker', at: now });
    appendAudit(db, { orgId: org.id, at: now, actorUserId: user.id, action: 'safety.reported', entity: 'safety_case', entityId: id, details: { confidential: false, category: input.category, urgent: input.urgent } });
    return { id };
  });
}

/**
 * Files a confidential report. Times derived from it are rounded down to the start of the local day
 * so they cannot be matched against a check-in or check-out.
 */
export function createConfidentialReport(db: Db, org: OrgRow, input: NewReport, now: number, code = newTrackingCode()) {
  return tx(db, () => {
    assertSite(db, org.id, input.siteId);
    const day = localDateKey(now, org.time_zone);
    const dayStart = zonedToUtc(day, '00:00', org.time_zone);
    const id = insert(
      db,
      `INSERT INTO safety_cases (org_id, site_id, reporter_user_id, confidential, tracking_hash, category, urgent, description, status, created_on, created_at, updated_at)
       VALUES (?, ?, NULL, 1, ?, ?, ?, ?, 'submitted', ?, NULL, ?)`,
      org.id,
      input.siteId,
      sha256(normaliseTrackingCode(code)),
      input.category,
      input.urgent ? 1 : 0,
      input.description,
      day,
      dayStart,
    );
    addCaseEvent(db, { orgId: org.id, caseType: 'safety', caseId: id, from: null, to: 'submitted', note: null, actorUserId: null, actorRole: 'reporter', at: dayStart });
    appendAudit(db, { orgId: org.id, at: dayStart, actorUserId: null, action: 'safety.reported', entity: 'safety_case', entityId: id, details: { confidential: true, category: input.category, urgent: input.urgent } });
    return { id, trackingCode: code };
  });
}

function findByCode(db: Db, code: string): SafetyRow | undefined {
  return one<SafetyRow>(db, 'SELECT * FROM safety_cases WHERE tracking_hash = ?', sha256(normaliseTrackingCode(code)));
}

/** What the holder of a tracking code may see: status, category, dates and the employer's public notes. */
export function publicCaseStatus(db: Db, code: string) {
  const c = findByCode(db, code);
  if (!c) throw notFound();
  const org = one<{ name: string }>(db, 'SELECT name FROM orgs WHERE id = ?', c.org_id)!;
  return {
    org: org.name,
    category: c.category,
    urgent: c.urgent === 1,
    status: c.status,
    createdOn: c.created_on,
    events: caseEvents(db, 'safety', c.id, true).map((e) => ({ toStatus: e.toStatus, note: e.actorRole === 'admin' ? e.note : null, at: e.at, by: e.actorRole })),
  };
}

export function reopenByCode(db: Db, code: string, note: string, now: number) {
  return tx(db, () => {
    const c = findByCode(db, code);
    if (!c) throw notFound();
    if (c.status !== 'resolved') throw conflict('invalid_transition', 'Only resolved reports can be reopened.');
    const org = one<OrgRow>(db, 'SELECT * FROM orgs WHERE id = ?', c.org_id)!;
    const dayStart = zonedToUtc(localDateKey(now, org.time_zone), '00:00', org.time_zone);
    run(db, "UPDATE safety_cases SET status = 'under_review', resolved_at = NULL, updated_at = ? WHERE id = ?", now, c.id);
    addCaseEvent(db, { orgId: c.org_id, caseType: 'safety', caseId: c.id, from: 'resolved', to: 'under_review', note, actorUserId: null, actorRole: 'reporter', at: dayStart });
    appendAudit(db, { orgId: c.org_id, at: dayStart, actorUserId: null, action: 'safety.reopened', entity: 'safety_case', entityId: c.id, details: { by: 'reporter' } });
  });
}

export interface TransitionInput {
  to: SafetyStatus;
  note: string;
  /** When false, the note is internal and not shown to the reporter. */
  public: boolean;
}

export function transitionSafetyCase(db: Db, org: OrgRow, actor: UserRow, id: number, input: TransitionInput, now: number) {
  return tx(db, () => {
    const c = one<SafetyRow>(db, 'SELECT * FROM safety_cases WHERE id = ? AND org_id = ?', id, org.id);
    if (!c) throw notFound();
    const isReporter = actor.role === 'worker';
    if (isReporter && (c.reporter_user_id !== actor.id || c.status !== 'resolved' || input.to !== 'under_review')) {
      throw notFound();
    }
    if (!SAFETY_TRANSITIONS[c.status].includes(input.to)) {
      throw conflict('invalid_transition', `A case cannot move from ${c.status} to ${input.to}.`);
    }
    run(
      db,
      `UPDATE safety_cases SET status = ?, updated_at = ?,
         acknowledged_at = COALESCE(acknowledged_at, CASE WHEN ? IN ('acknowledged', 'under_review') THEN ? END),
         resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END
       WHERE id = ?`,
      input.to,
      now,
      input.to,
      now,
      input.to,
      now,
      id,
    );
    addCaseEvent(db, {
      orgId: org.id,
      caseType: 'safety',
      caseId: id,
      from: c.status,
      to: input.to,
      note: input.note,
      public: input.public,
      actorUserId: actor.id,
      actorRole: isReporter ? 'worker' : 'admin',
      at: now,
    });
    appendAudit(db, { orgId: org.id, at: now, actorUserId: actor.id, action: 'safety.transition', entity: 'safety_case', entityId: id, details: { from: c.status, to: input.to } });
  });
}

/** Employer view of a case. Confidential cases never carry reporter details, and small sites are not named. */
function toAdminCase(c: SafetyRow & { reporter_name: string | null; site_name: string | null }, smallSites: Set<number>, ackHours: number, now: number) {
  const withheld = c.confidential === 1 && c.site_id !== null && smallSites.has(c.site_id);
  const ackDeadline = (c.created_at ?? c.updated_at) + ackHours * 3_600_000;
  return {
    id: c.id,
    confidential: c.confidential === 1,
    reporter: c.confidential === 1 ? null : c.reporter_name,
    site: withheld ? null : c.site_name,
    siteWithheld: withheld,
    category: c.category,
    urgent: c.urgent === 1,
    description: c.description,
    status: c.status,
    createdOn: c.created_on,
    acknowledgedAt: c.acknowledged_at,
    resolvedAt: c.resolved_at,
    updatedAt: c.updated_at,
    overdue: c.urgent === 1 && c.status === 'submitted' && now > ackDeadline,
  };
}

export type AdminSafetyCase = ReturnType<typeof toAdminCase>;

export function listSafetyCases(db: Db, org: OrgRow, now: number): AdminSafetyCase[] {
  const smallSites = new Set(listSites(db, org.id).filter((s) => s.headcount < org.min_group_size).map((s) => s.id));
  return all<SafetyRow & { reporter_name: string | null; site_name: string | null }>(
    db,
    `SELECT c.*, u.name AS reporter_name, s.name AS site_name FROM safety_cases c
       LEFT JOIN users u ON u.id = c.reporter_user_id LEFT JOIN sites s ON s.id = c.site_id
      WHERE c.org_id = ? ORDER BY CASE c.status WHEN 'resolved' THEN 1 ELSE 0 END, c.urgent DESC, c.updated_at DESC`,
    org.id,
  ).map((c) => toAdminCase(c, smallSites, org.urgent_ack_hours, now));
}

export function safetyCaseDetail(db: Db, org: OrgRow, id: number, now: number) {
  const c = listSafetyCases(db, org, now).find((x) => x.id === id);
  if (!c) throw notFound();
  return { case: c, events: caseEvents(db, 'safety', id, false), allowed: SAFETY_TRANSITIONS[c.status] };
}

export function workerSafetyCases(db: Db, user: UserRow) {
  return all<SafetyRow>(db, 'SELECT * FROM safety_cases WHERE reporter_user_id = ? ORDER BY updated_at DESC', user.id).map((c) => ({
    id: c.id,
    category: c.category,
    urgent: c.urgent === 1,
    description: c.description,
    status: c.status,
    createdOn: c.created_on,
    events: caseEvents(db, 'safety', c.id, true),
  }));
}
