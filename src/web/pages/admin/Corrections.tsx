import { useState } from 'react';
import { api, ApiError } from '../../api.ts';
import { ErrorNote, Loading, Notice, Pill, useData } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/i18n.tsx';
import { Link } from '../../router.tsx';
import { localDateKey } from '../../../shared/time.ts';
import type { CaseEvent, Me, PayData } from '../../types.ts';
import { FairnessReplay } from '../worker/FairnessReplay.tsx';
import { STATUS_LABEL } from './labels.ts';

interface CorrectionRow {
  id: number;
  user_id: number;
  worker_name: string;
  period: string;
  kind: 'pay' | 'attendance';
  status: 'open' | 'under_review' | 'resolved';
  outcome: 'corrected' | 'no_change' | null;
  worker_note: string | null;
  expected_paise: number | null;
  recorded_paise: number | null;
  check_in_event_id: number | null;
  proposed_check_out_at: number | null;
  created_at: number;
  updated_at: number;
}

export function CorrectionsPage() {
  const { money, month, day } = useI18n();
  const { data, error, loading, reload } = useData(() => api.get<CorrectionRow[]>('/api/admin/corrections'), []);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote error={error!} onRetry={reload} />;
  return (
    <>
      <h1>Pay and time requests</h1>
      <p className="muted">Workers ask here when their pay or recorded time looks wrong. Every decision needs a written reason and is kept in the audit trail.</p>
      {data.length === 0 ? (
        <p className="muted">No requests yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Worker</th>
                <th scope="col">Request</th>
                <th scope="col" className="num">Records / payroll</th>
                <th scope="col">Status</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/a/corrections/${c.id}`}>{c.worker_name}</Link>
                  </td>
                  <td>
                    {c.kind === 'pay' ? 'Pay check' : 'Missed check-out'}, {month(c.period)}
                  </td>
                  <td className="num">{c.expected_paise !== null ? `${money(c.expected_paise)} / ${money(c.recorded_paise!)}` : ''}</td>
                  <td>
                    <Pill status={c.status}>{c.outcome ? (c.outcome === 'corrected' ? 'Corrected' : 'No change') : STATUS_LABEL[c.status]}</Pill>
                  </td>
                  <td>{day(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface Detail {
  correction: CorrectionRow;
  events: CaseEvent[];
  pay: PayData;
}

export function CorrectionDetail({ id, me }: { id: number; me: Me }) {
  const { money, month, time, day } = useI18n();
  const { data, error, loading, reload } = useData(() => api.get<Detail>(`/api/admin/corrections/${id}`), [id]);
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<'corrected' | 'no_change'>('corrected');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote error={error!} onRetry={reload} />;
  const c = data.correction;
  const proposed = c.proposed_check_out_at;

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setActionError(null);
    try {
      await fn();
      setDone(message);
      reload();
    } catch (e) {
      setActionError(e as ApiError);
    }
  };

  const resolve = () => {
    const body: Record<string, unknown> = { outcome, note };
    if (c.kind === 'attendance' && outcome === 'corrected' && checkOutTime && proposed) {
      body.checkOutDate = localDateKey(proposed, me.org.timeZone);
      body.checkOutTime = checkOutTime;
    }
    return act(() => api.post(`/api/admin/corrections/${id}/resolve`, body), 'Decision recorded. The worker can see it now.');
  };

  return (
    <>
      <Link to="/a/corrections" className="back">
        ← Pay and time requests
      </Link>
      <h1>
        {c.worker_name}: {c.kind === 'pay' ? 'pay check' : 'missed check-out'}, {month(c.period)}
      </h1>
      <div className="grid-2">
        <section className="card">
          <h2>Request</h2>
          <p>
            <Pill status={c.status}>{c.outcome ? (c.outcome === 'corrected' ? 'Corrected' : 'No change') : STATUS_LABEL[c.status]}</Pill>
          </p>
          {c.kind === 'pay' && c.expected_paise !== null && (
            <p>
              When asking, the worker saw records worth <strong className="num">{money(c.expected_paise)}</strong> against payroll of{' '}
              <strong className="num">{money(c.recorded_paise!)}</strong>.
            </p>
          )}
          {c.kind === 'attendance' && proposed && (
            <p>
              The worker says they left at <strong>{time(proposed)}</strong> on {day(proposed)}. Check this against the gate or site register.
            </p>
          )}
          <ol className="timeline">
            {data.events.map((e) => (
              <li key={e.id}>
                <span className="timeline-status">{STATUS_LABEL[e.toStatus]}</span>
                <span className="muted small">
                  {' '}
                  · {e.actorRole} · {day(e.at)} {time(e.at)}
                </span>
                {e.note && <p>{e.note}</p>}
              </li>
            ))}
          </ol>

          {done && <Notice tone="good">{done}</Notice>}
          {actionError && <ErrorNote error={actionError} />}

          {c.status === 'open' && (
            <button type="button" className="btn btn-secondary" onClick={() => act(() => api.post(`/api/admin/corrections/${id}/review`), 'Marked as under review.')}>
              Start review
            </button>
          )}
          {c.status !== 'resolved' && (
            <div className="resolve">
              <h3>Decision</h3>
              <fieldset>
                <legend className="sr-only">Outcome</legend>
                <label className="choice-inline">
                  <input type="radio" name="outcome" checked={outcome === 'corrected'} onChange={() => setOutcome('corrected')} />
                  {c.kind === 'pay' ? 'Correct payroll to the calculated amount' : 'Record the check-out'}
                </label>
                <label className="choice-inline">
                  <input type="radio" name="outcome" checked={outcome === 'no_change'} onChange={() => setOutcome('no_change')} />
                  No change
                </label>
              </fieldset>
              {c.kind === 'attendance' && outcome === 'corrected' && (
                <div className="field">
                  <label htmlFor="co-time">Check-out time (leave empty to accept {proposed ? time(proposed) : 'the proposal'})</label>
                  <input id="co-time" type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} />
                </div>
              )}
              {c.kind === 'pay' && outcome === 'corrected' && data.pay.comparison && (
                <p className="hint">
                  A new payroll version of {money(data.pay.replay.expected.grossPaise)} is recorded as approved. Version {data.pay.payroll?.version} stays in the history.
                </p>
              )}
              <div className="field">
                <label htmlFor="decision-note">Reason the worker will read (at least 10 characters)</label>
                <textarea id="decision-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <button type="button" className="btn btn-primary" disabled={note.trim().length < 10} onClick={resolve}>
                Record decision
              </button>
            </div>
          )}
          {data.pay.payroll?.status === 'approved' && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => act(() => api.post(`/api/admin/payroll/${data.pay.payroll!.id}/mark-paid`), 'Marked as paid.')}
            >
              Mark version {data.pay.payroll.version} as paid
            </button>
          )}
        </section>
        <section className="card">
          <FairnessReplay data={data.pay} orgName={me.org.name} readOnly />
        </section>
      </div>
    </>
  );
}
