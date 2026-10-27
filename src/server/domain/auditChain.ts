/**
 * Tamper-evident audit log. Every row stores the SHA-256 of its own content plus the previous
 * row's hash, so editing or deleting any past row breaks verification from that row onward.
 */
import { createHash } from 'node:crypto';
import { all, insert, one, type Db } from '../db/db.ts';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditEntry {
  orgId: number;
  at: number;
  actorUserId: number | null;
  action: string;
  entity: string;
  entityId: number | null;
  details: Record<string, unknown>;
}

interface AuditRow {
  id: number;
  org_id: number;
  seq: number;
  at: number;
  actor_user_id: number | null;
  action: string;
  entity: string;
  entity_id: number | null;
  details_json: string;
  prev_hash: string;
  hash: string;
}

/** JSON with object keys sorted, so the same content always hashes the same way. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function rowHash(prevHash: string, r: Omit<AuditRow, 'id' | 'hash' | 'prev_hash'>): string {
  return sha256(
    [prevHash, r.org_id, r.seq, r.at, r.actor_user_id ?? '', r.action, r.entity, r.entity_id ?? '', r.details_json].join('|'),
  );
}

/** Appends an entry. Call inside the same transaction as the change it records. */
export function appendAudit(db: Db, e: AuditEntry): number {
  const last = one<{ seq: number; hash: string }>(
    db,
    'SELECT seq, hash FROM audit_events WHERE org_id = ? ORDER BY seq DESC LIMIT 1',
    e.orgId,
  );
  const row = {
    org_id: e.orgId,
    seq: (last?.seq ?? 0) + 1,
    at: e.at,
    actor_user_id: e.actorUserId,
    action: e.action,
    entity: e.entity,
    entity_id: e.entityId,
    details_json: canonicalJson(e.details),
  };
  const prevHash = last?.hash ?? GENESIS_HASH;
  return insert(
    db,
    `INSERT INTO audit_events (org_id, seq, at, actor_user_id, action, entity, entity_id, details_json, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.org_id,
    row.seq,
    row.at,
    row.actor_user_id,
    row.action,
    row.entity,
    row.entity_id,
    row.details_json,
    prevHash,
    rowHash(prevHash, row),
  );
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  headHash: string;
  /** First sequence number whose content or link does not match. */
  brokenAtSeq: number | null;
}

export function verifyAuditChain(db: Db, orgId: number): ChainVerification {
  const rows = all<AuditRow>(db, 'SELECT * FROM audit_events WHERE org_id = ? ORDER BY seq', orgId);
  let prev = GENESIS_HASH;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const expectedSeq = i + 1;
    if (r.seq !== expectedSeq || r.prev_hash !== prev || r.hash !== rowHash(prev, r)) {
      return { valid: false, checked: i, headHash: prev, brokenAtSeq: expectedSeq };
    }
    prev = r.hash;
  }
  return { valid: true, checked: rows.length, headHash: prev, brokenAtSeq: null };
}
