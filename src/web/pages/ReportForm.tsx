/**
 * Safety and grievance report form, used by signed-in workers and by the public confidential page.
 * Confidential reports are sent with cookies omitted to an endpoint that never reads the session.
 */
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api.ts';
import { Icon, type IconName } from '../components/Icon.tsx';
import { ErrorNote, Notice, useData } from '../components/ui.tsx';
import { useI18n } from '../i18n/i18n.tsx';
import type { SafetyCategory } from '../../shared/types.ts';

const CATEGORIES: Array<{ id: SafetyCategory; icon: IconName }> = [
  { id: 'hazard', icon: 'alert' },
  { id: 'equipment', icon: 'tool' },
  { id: 'ppe', icon: 'hardhat' },
  { id: 'workload', icon: 'clock' },
  { id: 'wages', icon: 'rupee' },
  { id: 'mistreatment', icon: 'hand' },
  { id: 'other', icon: 'dots' },
];

interface OrgForm {
  name: string;
  sites: Array<{ id: number; name: string; small: boolean }>;
}

export function ReportForm({ orgCode, allowNamed, onSent }: { orgCode: string; allowNamed: boolean; onSent?: () => void }) {
  const { t } = useI18n();
  const org = useData(() => api.getAnonymous<OrgForm>(`/api/public/orgs/${encodeURIComponent(orgCode)}`), [orgCode]);
  const [category, setCategory] = useState<SafetyCategory | null>(null);
  const [urgent, setUrgent] = useState(false);
  const [description, setDescription] = useState('');
  const [siteId, setSiteId] = useState<string>('');
  const [mode, setMode] = useState<'named' | 'confidential'>(allowNamed ? 'named' : 'confidential');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{ code?: string } | null>(null);

  if (org.error) return <Notice tone="danger" icon="alert">{t('report.notFound')}</Notice>;

  if (result) {
    return result.code ? (
      <div className="card" role="status">
        <Notice tone="good">{t('help.sentConfidential')}</Notice>
        <p>{t('help.codeIntro')}</p>
        <p className="tracking-code" data-testid="tracking-code">
          {result.code}
        </p>
        <p className="hint">{t('help.codeLimits')}</p>
      </div>
    ) : (
      <Notice tone="good">{t('help.sentNamed')}</Notice>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!category) return;
    setBusy(true);
    setError(null);
    // Urgent dangers may be sent with no words at all; the category says enough to act.
    const text = description.trim() || t(`help.category.${category}`);
    const body = { category, urgent, description: text, siteId: siteId ? Number(siteId) : null };
    try {
      if (mode === 'named') {
        await api.post('/api/worker/safety', body);
        setResult({});
      } else {
        const res = await api.postAnonymous<{ trackingCode: string }>(`/api/public/orgs/${encodeURIComponent(orgCode)}/reports`, body);
        setResult({ code: res.trackingCode });
      }
      onSent?.();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="report-form">
      <fieldset>
        <legend>{t('help.reportIntro')}</legend>
        <div className="tiles">
          {CATEGORIES.map((c) => (
            <label key={c.id} className={`tile ${category === c.id ? 'selected' : ''}`}>
              <input type="radio" name="category" value={c.id} checked={category === c.id} onChange={() => setCategory(c.id)} />
              <Icon name={c.icon} size={28} />
              <span>{t(`help.category.${c.id}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {category && (
        <>
          <label className="check urgent">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
            <span>{t('help.urgent')}</span>
          </label>

          <div className="field">
            <label htmlFor="report-text">{t('help.describe')}</label>
            <textarea
              id="report-text"
              rows={3}
              maxLength={2000}
              value={description}
              placeholder={t('help.describePlaceholder')}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {org.data && (
            <div className="field">
              <label htmlFor="report-site">{t('help.site')}</label>
              <select id="report-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                <option value="">{t('help.siteAny')}</option>
                {org.data.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {allowNamed && (
            <fieldset>
              <legend>{t('help.who')}</legend>
              <label className={`choice ${mode === 'named' ? 'selected' : ''}`}>
                <input type="radio" name="mode" checked={mode === 'named'} onChange={() => setMode('named')} />
                <span>
                  <strong>{t('help.named')}</strong>
                  <span className="hint">{t('help.namedHint')}</span>
                </span>
              </label>
              <label className={`choice ${mode === 'confidential' ? 'selected' : ''}`}>
                <input type="radio" name="mode" checked={mode === 'confidential'} onChange={() => setMode('confidential')} />
                <span>
                  <strong>
                    <Icon name="lock" size={16} /> {t('help.confidential')}
                  </strong>
                  <span className="hint">{t('help.confidentialHint')}</span>
                </span>
              </label>
            </fieldset>
          )}
          {mode === 'confidential' && <p className="hint">{t('help.codeLimits')}</p>}

          {error && <ErrorNote error={error} />}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || (!urgent && description.trim().length < 3)} aria-busy={busy}>
            <Icon name="arrow" />
            {t('help.send')}
          </button>
        </>
      )}
    </form>
  );
}
