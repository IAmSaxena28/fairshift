import { useState } from 'react';
import { api, ApiError } from '../../api.ts';
import { Icon } from '../../components/Icon.tsx';
import { ErrorNote, Loading, Notice, Pill, useData } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/i18n.tsx';
import { Link, query, useRouter } from '../../router.tsx';
import type { SafetyStatus } from '../../../shared/types.ts';
import type { AdminSafetyCase, CaseEvent } from '../../types.ts';
import { CATEGORY_LABEL, STATUS_LABEL } from './labels.ts';

const FILTERS = ['open', 'urgent', 'resolved', 'all'] as const;

function CaseSite({ c }: { c: AdminSafetyCase }) {
  if (c.siteWithheld) return <span className="muted">Site withheld (small team)</span>;
  return <>{c.site ?? 'Not given'}</>;
}

export function SafetyPage() {
  const { date } = useI18n();
  const { path, navigate } = useRouter();
  const filter = (query(path, 'show') as (typeof FILTERS)[number]) ?? 'open';
  const { data, error, loading, reload } = useData(() => api.get<AdminSafetyCase[]>('/api/admin/safety'), []);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote error={error!} onRetry={reload} />;

  const rows = data.filter((c) =>
    filter === 'all' ? true : filter === 'resolved' ? c.status === 'resolved' : filter === 'urgent' ? c.urgent && c.status !== 'resolved' : c.status !== 'resolved',
  );

  return (
    <>
      <h1>Safety and grievances</h1>
      <p className="muted">
        Confidential reports arrive without a name, account or exact time. On sites with fewer than five workers the site is withheld too.
      </p>
      <div className="segmented" role="group" aria-label="Filter cases">
        {FILTERS.map((f) => (
          <button key={f} type="button" className={filter === f ? 'active' : ''} aria-pressed={filter === f} onClick={() => navigate(`/a/safety?show=${f}`)}>
            {f[0]!.toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Report</th>
              <th scope="col">Type</th>
              <th scope="col">Site</th>
              <th scope="col">From</th>
              <th scope="col">Status</th>
              <th scope="col">Reported</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={c.overdue ? 'row-danger' : ''}>
                <td>
                  <Link to={`/a/safety/${c.id}`}>{c.description.length > 70 ? `${c.description.slice(0, 70)}…` : c.description}</Link>
                  {c.urgent && (
                    <span className="tag tag-danger">
                      <Icon name="alert" size={14} /> Urgent{c.overdue ? ', not acknowledged in time' : ''}
                    </span>
                  )}
                </td>
                <td>{CATEGORY_LABEL[c.category]}</td>
                <td>
                  <CaseSite c={c} />
                </td>
                <td>{c.confidential ? <span className="tag"><Icon name="lock" size={14} /> Confidential</span> : c.reporter}</td>
                <td>
                  <Pill status={c.status}>{STATUS_LABEL[c.status]}</Pill>
                </td>
                <td>{date(c.createdOn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="muted">No cases in this view.</p>}
      </div>
    </>
  );
}

const NEXT_LABEL: Record<string, string> = {
  acknowledged: 'Acknowledge',
  under_review: 'Start review',
  action_taken: 'Record action taken',
  resolved: 'Resolve',
};

export function SafetyDetail({ id }: { id: number }) {
  const { date, day, time } = useI18n();
  const { data, error, loading, reload } = useData(
    () => api.get<{ case: AdminSafetyCase; events: CaseEvent[]; allowed: SafetyStatus[] }>(`/api/admin/safety/${id}`),
    [id],
  );
  const [to, setTo] = useState<SafetyStatus | ''>('');
  const [note, setNote] = useState('');
  const [isPublic, setPublic] = useState(true);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote error={error!} onRetry={reload} />;
  const c = data.case;
  const next = to || data.allowed[0] || '';

  const submit = async () => {
    setActionError(null);
    try {
      await api.post(`/api/admin/safety/${id}/transition`, { to: next, note, public: isPublic });
      setNote('');
      setTo('');
      setDone(true);
      reload();
    } catch (e) {
      setActionError(e as ApiError);
    }
  };

  return (
    <>
      <Link to="/a/safety" className="back">
        ← Safety and grievances
      </Link>
      <h1>
        {CATEGORY_LABEL[c.category]} report {c.urgent && <span className="tag tag-danger">Urgent</span>}
      </h1>
      <div className="grid-2">
        <section className="card">
          <p className="quote">{c.description}</p>
          <dl className="facts">
            <dt>Status</dt>
            <dd>
              <Pill status={c.status}>{STATUS_LABEL[c.status]}</Pill>
            </dd>
            <dt>Site</dt>
            <dd>
              <CaseSite c={c} />
            </dd>
            <dt>Reported by</dt>
            <dd>{c.confidential ? 'Confidential: no name, account or time of day is stored' : c.reporter}</dd>
            <dt>Reported on</dt>
            <dd>{date(c.createdOn)}</dd>
          </dl>
          {c.overdue && (
            <Notice tone="danger" icon="alert">
              Urgent report not acknowledged within the organisation's time limit.
            </Notice>
          )}
        </section>
        <section className="card">
          <h2>History</h2>
          <ol className="timeline">
            {data.events.map((e) => (
              <li key={e.id}>
                <span className="timeline-status">{STATUS_LABEL[e.toStatus]}</span>
                <span className="muted small">
                  {' '}
                  · {e.actorRole === 'reporter' ? 'reporter' : e.actorRole} · {day(e.at)} {e.actorRole === 'admin' ? time(e.at) : ''}
                  {!e.public && ' · internal'}
                </span>
                {e.note && <p>{e.note}</p>}
              </li>
            ))}
          </ol>
          {done && <Notice tone="good">Update saved. The reporter can see public notes.</Notice>}
          {data.allowed.length > 0 && (
            <div className="resolve">
              <h3>Next step</h3>
              <div className="field">
                <label htmlFor="next-status">Move to</label>
                <select id="next-status" value={next} onChange={(e) => setTo(e.target.value as SafetyStatus)}>
                  {data.allowed.map((s) => (
                    <option key={s} value={s}>
                      {NEXT_LABEL[s] ?? STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="transition-note">{next === 'action_taken' ? 'What was done' : 'Note'}</label>
                <textarea id="transition-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <label className="check">
                <input type="checkbox" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} />
                <span>Show this note to the person who reported</span>
              </label>
              {c.status === 'under_review' && <p className="hint">A case can only be resolved after an action is recorded.</p>}
              {actionError && <ErrorNote error={actionError} />}
              <button type="button" className="btn btn-primary" disabled={note.trim().length < 3} onClick={submit}>
                Save
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
