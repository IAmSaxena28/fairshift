import { useState } from 'react';
import { api } from '../../api.ts';
import { Icon } from '../../components/Icon.tsx';
import { ErrorNote, Loading, Notice, useData } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/i18n.tsx';

interface AuditRow {
  seq: number;
  at: number;
  action: string;
  entity: string;
  entityId: number | null;
  details: string;
  hash: string;
  prevHash: string;
  actor: string | null;
}

interface Verification {
  valid: boolean;
  checked: number;
  headHash: string;
  brokenAtSeq: number | null;
}

export function AuditPage() {
  const { day, time } = useI18n();
  const { data, error, loading, reload } = useData(() => api.get<AuditRow[]>('/api/admin/audit?limit=100'), []);
  const [verification, setVerification] = useState<Verification | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote error={error!} onRetry={reload} />;

  return (
    <>
      <h1>Audit trail</h1>
      <p className="muted">
        Every significant action is appended here. Each entry stores a SHA-256 hash that includes the previous entry's hash, so changing or deleting any past
        entry breaks the chain from that point.
      </p>
      <button type="button" className="btn btn-primary" onClick={async () => setVerification(await api.get<Verification>('/api/admin/audit/verify'))}>
        <Icon name="shield" /> Verify the whole chain
      </button>
      {verification &&
        (verification.valid ? (
          <Notice tone="good">
            Chain intact: {verification.checked} entries checked. Latest hash <span className="mono">{verification.headHash.slice(0, 16)}</span>
          </Notice>
        ) : (
          <Notice tone="danger" icon="alert">
            Chain broken at entry #{verification.brokenAtSeq}. A past record was changed outside the application.
          </Notice>
        ))}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">Action</th>
              <th scope="col">Details</th>
              <th scope="col">Hash</th>
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.seq}>
                <td className="num">{a.seq}</td>
                <td>
                  {day(a.at)} {time(a.at)}
                </td>
                <td>{a.actor ?? (a.action === 'safety.reported' ? 'Confidential reporter' : 'System')}</td>
                <td>
                  <code>{a.action}</code>
                </td>
                <td className="details">
                  <code>{a.details}</code>
                </td>
                <td className="mono">{a.hash.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
