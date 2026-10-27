import { useState } from 'react';
import { api } from '../../api.ts';
import { ErrorNote, Loading, Pill, useData } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/i18n.tsx';
import { Link, query, useRouter } from '../../router.tsx';
import type { CaseEvent, Me, WorkerCases } from '../../types.ts';
import { ReportForm } from '../ReportForm.tsx';

export function HelpPage({ me }: { me: Me }) {
  const { t } = useI18n();
  const { path } = useRouter();
  const tab = query(path, 'tab') === 'cases' ? 'cases' : 'report';

  return (
    <>
      <h1>{t('help.title')}</h1>
      <div className="segmented" role="tablist">
        <Link to="/w/help" role="tab" aria-selected={tab === 'report'} className={tab === 'report' ? 'active' : ''}>
          {t('help.report')}
        </Link>
        <Link to="/w/help?tab=cases" role="tab" aria-selected={tab === 'cases'} className={tab === 'cases' ? 'active' : ''}>
          {t('help.myCases')}
        </Link>
      </div>
      {tab === 'report' ? (
        <div role="tabpanel">
          <ReportForm orgCode={me.org.reportCode} allowNamed />
        </div>
      ) : (
        <div role="tabpanel">
          <MyCases />
        </div>
      )}
    </>
  );
}

function Timeline({ events }: { events: CaseEvent[] }) {
  const { t, time, day } = useI18n();
  return (
    <ol className="timeline">
      {events.map((e) => (
        <li key={e.id}>
          <span className="timeline-status">{t(`case.status.${e.toStatus as 'open'}`)}</span>
          <span className="muted small"> · {day(e.at)} {e.actorRole === 'admin' ? time(e.at) : ''}</span>
          {e.note && <p>{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}

function MyCases() {
  const { t, month, money, date } = useI18n();
  const { data, error, loading, reload } = useData(() => api.get<WorkerCases>('/api/worker/cases'), []);
  const [reopening, setReopening] = useState<string | null>(null);
  const [note, setNote] = useState('');

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote error={error!} onRetry={reload} />;
  if (data.corrections.length === 0 && data.safety.length === 0) return <p className="muted">{t('help.noCases')}</p>;

  const reopen = async (url: string) => {
    await api.post(url, { note });
    setReopening(null);
    setNote('');
    reload();
  };

  const reopenForm = (key: string, url: string) =>
    reopening === key ? (
      <div className="ask">
        <label htmlFor={`reopen-${key}`}>{t('help.reopenNote')}</label>
        <textarea id={`reopen-${key}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="btn btn-primary" disabled={note.trim().length < 3} onClick={() => reopen(url)}>
          {t('common.submit')}
        </button>
      </div>
    ) : (
      <button type="button" className="btn btn-quiet" onClick={() => setReopening(key)}>
        {t('help.reopen')}
      </button>
    );

  return (
    <ul className="cases">
      {data.corrections.map((c) => (
        <li key={`c${c.id}`} className="card">
          <div className="case-head">
            <strong>{t(c.kind === 'pay' ? 'help.pay' : 'help.attendance', { period: month(c.period) })}</strong>
            <Pill status={c.status}>{c.outcome ? t(`case.outcome.${c.outcome}`) : t(`case.status.${c.status}`)}</Pill>
          </div>
          {c.expectedPaise !== null && c.recordedPaise !== null && (
            <p className="muted num">
              {money(c.expectedPaise)} / {money(c.recordedPaise)}
            </p>
          )}
          <Timeline events={c.events} />
          {c.status === 'resolved' && reopenForm(`c${c.id}`, `/api/worker/corrections/${c.id}/reopen`)}
        </li>
      ))}
      {data.safety.map((c) => (
        <li key={`s${c.id}`} className="card">
          <div className="case-head">
            <strong>{t(`help.category.${c.category}`)}</strong>
            <Pill status={c.status}>{t(`case.status.${c.status}`)}</Pill>
          </div>
          <p className="muted small">{date(c.createdOn)}</p>
          <p>{c.description}</p>
          <Timeline events={c.events} />
          {c.status === 'resolved' && reopenForm(`s${c.id}`, `/api/worker/safety/${c.id}/reopen`)}
        </li>
      ))}
    </ul>
  );
}
