/** Pages that work without signing in: confidential reporting and tracking by code. */
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { LanguageSwitch, Notice, Pill } from '../components/ui.tsx';
import { useI18n } from '../i18n/i18n.tsx';
import { Link } from '../router.tsx';
import type { SafetyCategory, SafetyStatus } from '../../shared/types.ts';
import { ReportForm } from './ReportForm.tsx';

function PublicShell({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="login">
      <header className="login-header">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            F
          </span>
          <span className="brand-name">{t('app.name')}</span>
        </Link>
        <LanguageSwitch />
      </header>
      <main id="main" className="login-main">
        <h1>{title}</h1>
        {children}
        <p className="demo-note">{t('common.demoData')}</p>
      </main>
    </div>
  );
}

export function PublicReportPage({ orgCode }: { orgCode: string }) {
  const { t } = useI18n();
  const orgs = ['STHAPATI', 'GREENFIELD'];
  return (
    <PublicShell title={t('report.title')}>
      <Notice tone="info" icon="lock">
        {t('report.intro')}
      </Notice>
      <div className="segmented" role="group" aria-label={t('report.orgLabel')}>
        {orgs.map((code) => (
          <Link key={code} to={`/report/${code}`} className={code === orgCode.toUpperCase() ? 'active' : ''}>
            {code === 'STHAPATI' ? 'Sthapati Builders' : 'Greenfield College'}
          </Link>
        ))}
      </div>
      <ReportForm key={orgCode} orgCode={orgCode} allowNamed={false} />
    </PublicShell>
  );
}

interface PublicStatus {
  org: string;
  category: SafetyCategory;
  urgent: boolean;
  status: SafetyStatus;
  createdOn: string;
  events: Array<{ toStatus: SafetyStatus; note: string | null; at: number; by: string }>;
}

export function TrackPage() {
  const { t, date, day } = useI18n();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<PublicStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [note, setNote] = useState('');
  const [reopening, setReopening] = useState(false);

  const check = async (e?: FormEvent) => {
    e?.preventDefault();
    setNotFound(false);
    setError(null);
    try {
      setResult(await api.getAnonymous<PublicStatus>(`/api/public/reports/${encodeURIComponent(code.trim())}`));
    } catch (err) {
      setResult(null);
      if ((err as ApiError).status === 404) setNotFound(true);
      else setError(err as ApiError);
    }
  };

  const reopen = async () => {
    await api.postAnonymous(`/api/public/reports/${encodeURIComponent(code.trim())}/reopen`, { note });
    setReopening(false);
    setNote('');
    await check();
  };

  return (
    <PublicShell title={t('track.title')}>
      <form onSubmit={check} className="card">
        <div className="field">
          <label htmlFor="code">{t('track.code')}</label>
          <input
            id="code"
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
          />
        </div>
        <button type="submit" className="btn btn-primary btn-block">
          {t('track.check')}
        </button>
      </form>
      {notFound && <Notice tone="warn" icon="alert">{t('track.notFound')}</Notice>}
      {error && <Notice tone="danger" icon="alert">{t('common.error')}</Notice>}
      {result && (
        <section className="card" aria-live="polite">
          <div className="case-head">
            <strong>{t(`help.category.${result.category}`)}</strong>
            <Pill status={result.status}>{t(`case.status.${result.status}`)}</Pill>
          </div>
          <p className="muted">
            {result.org} · {t('track.reported', { date: date(result.createdOn) })}
          </p>
          <ol className="timeline">
            {result.events.map((e, i) => (
              <li key={i}>
                <span className="timeline-status">{t(`case.status.${e.toStatus}`)}</span>
                <span className="muted small"> · {day(e.at)}</span>
                {e.note && <p>{e.note}</p>}
              </li>
            ))}
          </ol>
          {result.status === 'resolved' &&
            (reopening ? (
              <div className="ask">
                <label htmlFor="reopen-note">{t('help.reopenNote')}</label>
                <textarea id="reopen-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                <button type="button" className="btn btn-primary" disabled={note.trim().length < 3} onClick={reopen}>
                  {t('common.submit')}
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => setReopening(true)}>
                <Icon name="alert" /> {t('track.reopen')}
              </button>
            ))}
        </section>
      )}
    </PublicShell>
  );
}
