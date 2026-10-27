import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api.ts';
import { ErrorNote, Loading, Notice, useData } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/i18n.tsx';
import type { PolicyRules } from '../../../shared/types.ts';

interface PolicyData {
  currentPeriod: string;
  groups: Array<{
    payGroup: string;
    current: { version: number; hash: string; effectivePeriod: string; rules: PolicyRules };
    versions: Array<{ version: number; effectivePeriod: string; hash: string; createdAt: number }>;
  }>;
}

export function PolicyPage() {
  const { month, duration, money } = useI18n();
  const { data, error, loading, reload } = useData(() => api.get<PolicyData>('/api/admin/policy'), []);
  const [draft, setDraft] = useState<PolicyRules | null>(null);
  const [note, setNote] = useState('');
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const group = data?.groups[0];

  useEffect(() => {
    if (group) setDraft(group.current.rules);
  }, [group]);

  if (loading && !data) return <Loading />;
  if (error || !data || !group || !draft) return error ? <ErrorNote error={error} onRetry={reload} /> : <Loading />;
  const r = group.current.rules;

  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));
  const save = async () => {
    setSaveError(null);
    try {
      const res = await api.post<{ version: number }>('/api/admin/policy', {
        payGroup: group.payGroup,
        effectivePeriod: data.currentPeriod,
        note,
        overtime: draft.overtime,
        unpaidBreak: draft.unpaidBreak,
        nightAllowancePaise: draft.nightAllowancePaise,
        fatigue: draft.fatigue,
      });
      setSaved(res.version);
      setNote('');
      reload();
    } catch (e) {
      setSaveError(e as ApiError);
    }
  };

  return (
    <>
      <h1>Pay rules</h1>
      <Notice tone="info" icon="lock">
        Rules are versioned. A change applies from {month(data.currentPeriod)} onward; earlier months keep the version they were worked out with. These are
        demonstration values, not a statement of what the law requires.
      </Notice>
      <div className="grid-2">
        <section className="card">
          <h2>
            In force: version {group.current.version} <span className="muted small">({group.payGroup})</span>
          </h2>
          <dl className="facts">
            <dt>Overtime</dt>
            <dd>
              {r.overtime.eligible
                ? `After ${duration(r.overtime.thresholdMinutes)} per ${r.overtime.mode === 'daily' ? 'day' : 'week'}, paid at ${r.overtime.multiplierBp / 10_000}×`
                : 'Not eligible'}
            </dd>
            <dt>Unpaid break</dt>
            <dd>
              {r.unpaidBreak.minutes} min on shifts over {duration(r.unpaidBreak.afterMinutes)}
            </dd>
            <dt>Night allowance</dt>
            <dd>{money(r.nightAllowancePaise)} per shift crossing midnight</dd>
            <dt>Rest limits</dt>
            <dd>
              Shift ≤ {duration(r.fatigue.maxShiftMinutes)}, rest ≥ {duration(r.fatigue.minRestMinutes)}, week ≤ {duration(r.fatigue.maxWeeklyMinutes)}, ≤{' '}
              {r.fatigue.maxConsecutiveDays} days in a row
            </dd>
            <dt>Fingerprint</dt>
            <dd className="mono">{group.current.hash.slice(0, 16)}</dd>
          </dl>
          <h3>Versions</h3>
          <ul className="plain">
            {group.versions.map((v) => (
              <li key={v.version}>
                v{v.version} from {v.effectivePeriod === '2000-01' ? 'the start' : month(v.effectivePeriod)} · <span className="mono">{v.hash.slice(0, 12)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2>Propose a new version</h2>
          <div className="row">
            <div className="field">
              <label htmlFor="ot-threshold">Overtime after (minutes per {draft.overtime.mode === 'daily' ? 'day' : 'week'})</label>
              <input id="ot-threshold" type="number" min={0} value={draft.overtime.thresholdMinutes} onChange={(e) => setDraft({ ...draft, overtime: { ...draft.overtime, thresholdMinutes: num(e.target.value) } })} />
            </div>
            <div className="field">
              <label htmlFor="ot-mult">Overtime multiplier (×100)</label>
              <input id="ot-mult" type="number" min={100} max={400} value={draft.overtime.multiplierBp / 100} onChange={(e) => setDraft({ ...draft, overtime: { ...draft.overtime, multiplierBp: num(e.target.value) * 100 } })} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="max-week">Weekly limit for rest warnings (minutes)</label>
              <input id="max-week" type="number" min={0} value={draft.fatigue.maxWeeklyMinutes} onChange={(e) => setDraft({ ...draft, fatigue: { ...draft.fatigue, maxWeeklyMinutes: num(e.target.value) } })} />
            </div>
            <div className="field">
              <label htmlFor="min-rest">Minimum rest between shifts (minutes)</label>
              <input id="min-rest" type="number" min={0} value={draft.fatigue.minRestMinutes} onChange={(e) => setDraft({ ...draft, fatigue: { ...draft.fatigue, minRestMinutes: num(e.target.value) } })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="policy-note">Why is this changing?</label>
            <input id="policy-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {saved && <Notice tone="good">Version {saved} saved. It applies from {month(data.currentPeriod)}.</Notice>}
          {saveError && <ErrorNote error={saveError} />}
          <button type="button" className="btn btn-primary" disabled={note.trim().length < 5} onClick={save}>
            Save as new version
          </button>
        </section>
      </div>
    </>
  );
}
