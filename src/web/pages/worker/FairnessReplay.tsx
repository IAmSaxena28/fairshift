/**
 * The Fairness Replay: renders the pay engine's own steps, then compares them with payroll.
 * Every number on this screen comes from the server's calculation trace.
 */
import { useState } from 'react';
import { api } from '../../api.ts';
import { Icon } from '../../components/Icon.tsx';
import { ListenButton, Notice, Pill } from '../../components/ui.tsx';
import { useI18n, type I18n } from '../../i18n/i18n.tsx';
import type { ReplayStep } from '../../../shared/types.ts';
import type { PayData } from '../../types.ts';

const STEP_ICONS = {
  recorded_time: 'clock',
  unpaid_breaks: 'clock',
  payable_time: 'check',
  overtime_split: 'scale',
  base_pay: 'rupee',
  overtime_pay: 'rupee',
  night_allowance: 'moon',
  adjustments: 'list',
  expected_gross: 'rupee',
} as const;

/** One plain-language sentence per engine step, filled with that step's own inputs and output. */
export function stepSentence(step: ReplayStep, i18n: I18n, data: PayData): string | null {
  const { t, duration, money } = i18n;
  const n = (k: string) => Number(step.inputs[k] ?? 0);
  const totals = data.replay.totals;
  switch (step.id) {
    case 'recorded_time': {
      const main = t('pay.step.recorded_time', { shifts: n('shifts'), total: duration(step.output) });
      return n('excludedShifts') > 0 ? `${main} ${t('pay.step.recorded_time.excluded', { n: n('excludedShifts') })}` : main;
    }
    case 'unpaid_breaks':
      return t('pay.step.unpaid_breaks', { after: duration(n('afterMinutes')), break: duration(n('breakMinutes')), total: duration(step.output) });
    case 'payable_time':
      return t('pay.step.payable_time', { recorded: duration(n('recordedMinutes')), breaks: duration(n('breakMinutes')), total: duration(step.output) });
    case 'overtime_split':
      if (!step.inputs.eligible) return t('pay.step.overtime_split.none');
      return t(step.inputs.mode === 'weekly' ? 'pay.step.overtime_split.weekly' : 'pay.step.overtime_split.daily', {
        threshold: duration(n('thresholdMinutes')),
        total: duration(step.output),
        ordinary: duration(totals.ordinaryMinutes),
      });
    case 'base_pay':
      return step.inputs.basis === 'monthly'
        ? t('pay.step.base_pay.monthly', { salary: money(n('salaryPaise')), days: n('daysCounted'), daysInMonth: n('daysInPeriod'), total: money(step.output) })
        : t('pay.step.base_pay.hourly', { time: duration(n('minutes')), rate: money(n('ratePaisePerHour')), total: money(step.output) });
    case 'overtime_pay':
      if (n('minutes') === 0) return null;
      return t('pay.step.overtime_pay', {
        time: duration(n('minutes')),
        rate: money(n('ratePaisePerHour')),
        multiplier: `${n('multiplierBp') / 10_000}×`,
        total: money(step.output),
      });
    case 'night_allowance':
      return n('nightShifts') === 0 ? null : t('pay.step.night_allowance', { n: n('nightShifts'), allowance: money(n('allowancePaise')), total: money(step.output) });
    case 'adjustments':
      return n('count') === 0 ? null : t('pay.step.adjustments', { total: money(step.output) });
    case 'expected_gross':
      return t('pay.step.expected_gross', { total: money(step.output) });
  }
}

export function FairnessReplay({ data, orgName, onChanged, readOnly = false }: { data: PayData; orgName: string; onChanged?: () => void; readOnly?: boolean }) {
  const i18n = useI18n();
  const { t, money } = i18n;
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sentences = data.replay.steps
    .map((step) => ({ step, text: stepSentence(step, i18n, data) }))
    .filter((s): s is { step: ReplayStep; text: string } => s.text !== null);
  const cmp = data.comparison;
  const verdict = !cmp
    ? null
    : cmp.status === 'match'
      ? t('pay.match')
      : t(cmp.status === 'underpaid' ? 'pay.underpaid' : 'pay.overpaid', { amount: money(Math.abs(cmp.differencePaise)) });
  const diffs = cmp?.components.filter((c) => c.differencePaise !== 0) ?? [];
  const spoken = [...sentences.map((s) => s.text), data.payroll ? t('pay.recorded', { amount: money(data.payroll.grossPaise) }) : '', verdict ?? ''].join(' ');
  const openRequest = data.correction && data.correction.status !== 'resolved';

  const ask = async () => {
    setError(null);
    try {
      await api.post('/api/worker/corrections', { kind: 'pay', period: data.replay.periodId, note: note.trim() || undefined });
      setSent(true);
      setAsking(false);
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section aria-labelledby="replay-title" className="replay">
      <div className="replay-head">
        <h2 id="replay-title">{t('pay.replayTitle')}</h2>
        <ListenButton text={spoken} />
      </div>
      <p className="muted">{t('pay.replayIntro', { org: orgName })}</p>

      <ol className="steps">
        {sentences.map(({ step, text }) => (
          <li key={step.id} className={`step step-${step.id}`} data-step={step.id}>
            <span className="step-icon">
              <Icon name={STEP_ICONS[step.id]} />
            </span>
            <div>
              <p>{text}</p>
              {step.id === 'adjustments' && (
                <ul className="adjustments">
                  {data.adjustments.map((a) => (
                    <li key={a.id}>
                      <span>{a.reason}</span>
                      <span className="num">{money(a.amountPaise)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>

      {data.payroll ? (
        <div className="compare">
          <h3>{t('pay.recordedTitle')}</h3>
          <div className="compare-row">
            <span>{t('pay.recorded', { amount: money(data.payroll.grossPaise) })}</span>
            <Pill status={data.payroll.status}>{t(`pay.status.${data.payroll.status}`)}</Pill>
          </div>
          <div className={`verdict verdict-${cmp!.status}`} role="status" data-testid="verdict">
            <Icon name={cmp!.status === 'match' ? 'check' : 'alert'} />
            <div>
              <p className="verdict-main">{verdict}</p>
              {diffs.map((d) => (
                <p key={d.component}>
                  {t('pay.differenceIn', {
                    component: t(`pay.component.${d.component}`),
                    expected: money(d.expectedPaise),
                    recorded: money(d.recordedPaise),
                  })}
                </p>
              ))}
            </div>
          </div>

          {data.correction && (
            <p>
              {t('pay.requestStatus', {
                status: data.correction.outcome ? t(`case.outcome.${data.correction.outcome}`) : t(`case.status.${data.correction.status}`),
              })}
            </p>
          )}

          {!readOnly && cmp!.status !== 'match' && !openRequest && !sent && (
            asking ? (
              <div className="ask">
                <label htmlFor="ask-note">{t('pay.askNote')}</label>
                <textarea id="ask-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
                {error && <p className="error" role="alert">{error}</p>}
                <div className="row">
                  <button type="button" className="btn btn-primary" onClick={ask}>
                    {t('common.submit')}
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => setAsking(false)}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn-primary btn-block" onClick={() => setAsking(true)}>
                <Icon name="hand" />
                {t('pay.askCheck')}
              </button>
            )
          )}
          {sent && <Notice tone="good">{t('pay.askSent')}</Notice>}

          {data.history.length > 1 && (
            <details className="history">
              <summary>{t('pay.history')}</summary>
              <ol>
                {data.history.map((h) => (
                  <li key={h.id}>
                    <strong>{t('pay.version', { v: h.version })}</strong>: <span className="num">{money(h.grossPaise)}</span>{' '}
                    <Pill status={h.status}>{t(`pay.status.${h.status}`)}</Pill>
                    {h.note && <p className="hint">{h.note}</p>}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      ) : (
        <Notice tone="info" icon="clock">{t('pay.noPayroll')}</Notice>
      )}

      <p className="hint rules">
        <Icon name="lock" size={16} /> {t('pay.rules', { v: data.policy.version })}. {t('pay.rulesHint', { hash: data.policy.hash.slice(0, 12) })} {t('pay.notLegal')}
      </p>
    </section>
  );
}
