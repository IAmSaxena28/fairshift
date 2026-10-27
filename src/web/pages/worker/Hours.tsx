import { useState } from 'react';
import { api } from '../../api.ts';
import { Icon } from '../../components/Icon.tsx';
import { ErrorNote, Field, Loading, Notice, StatTile, useData } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/i18n.tsx';
import { query, useRouter } from '../../router.tsx';
import { addDays, localDateKey, periodOf, previousPeriod } from '../../../shared/time.ts';
import type { FatigueWarning, SessionCalc } from '../../../shared/types.ts';
import type { HoursData, Me } from '../../types.ts';

export function FatigueList({ warnings }: { warnings: FatigueWarning[] }) {
  const { t, duration, date } = useI18n();
  if (warnings.length === 0) return null;
  const fmt = (w: FatigueWarning, v: number) => (w.rule === 'consecutive_days' ? String(v) : duration(v));
  return (
    <Notice tone="warn" icon="moon">
      <strong>{t('fatigue.title')}</strong>
      <ul className="plain">
        {warnings.map((w, i) => (
          <li key={i}>{t(`fatigue.${w.rule}`, { date: date(w.date), value: fmt(w, w.value), limit: fmt(w, w.limit) })}</li>
        ))}
      </ul>
      <p className="hint">{t('fatigue.note')}</p>
    </Notice>
  );
}


export function HoursPage({ me }: { me: Me }) {
  const { t, duration, month } = useI18n();
  const { path, navigate } = useRouter();
  const current = periodOf(localDateKey(Date.now(), me.org.timeZone));
  const period = query(path, 'period') ?? current;
  const { data, error, loading, reload } = useData(() => api.get<HoursData>(`/api/worker/hours?period=${period}`), [period]);
  const periods = [current, previousPeriod(current)];

  return (
    <>
      <h1>{t('hours.title')}</h1>
      <div className="field">
        <label htmlFor="hours-month">{t('hours.month')}</label>
        <select id="hours-month" value={period} onChange={(e) => navigate(`/w/hours?period=${e.target.value}`)}>
          {periods.map((p) => (
            <option key={p} value={p}>
              {month(p)}
            </option>
          ))}
        </select>
      </div>
      {loading && !data ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote error={error!} onRetry={reload} />
      ) : (
        <>
          <div className="stats">
            <StatTile label={t('hours.total')} value={duration(data.totals.payableMinutes)} />
            <StatTile label={t('hours.overtime')} value={duration(data.totals.overtimeMinutes)} />
            <StatTile label={t('hours.shifts')} value={data.sessions.length} />
          </div>
          <FatigueList warnings={data.fatigue} />
          {data.sessions.length === 0 ? (
            <p className="muted">{t('hours.none')}</p>
          ) : (
            <ul className="sessions">
              {data.sessions
                .slice()
                .reverse()
                .map((s) => (
                  <SessionRow key={s.checkInId} s={s} onFixed={reload} />
                ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function SessionRow({ s, onFixed }: { s: SessionCalc; onFixed: () => void }) {
  const { t, time, date, duration } = useI18n();
  const [fixing, setFixing] = useState(false);
  const [leftAt, setLeftAt] = useState('');
  const [leftOn, setLeftOn] = useState(s.date);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    setErr(null);
    try {
      await api.post('/api/worker/corrections', { kind: 'attendance', checkInEventId: s.checkInId, checkOutDate: leftOn, checkOutTime: leftAt });
      setSent(true);
      setFixing(false);
      onFixed();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <li className={`session ${s.flag ? `session-${s.flag}` : ''}`}>
      <div className="session-main">
        <div>
          <strong>{date(s.date)}</strong>
          <div className="muted">
            {time(s.start)} – {s.end ? time(s.end) : '…'}
            {s.crossesMidnight && (
              <span className="tag">
                <Icon name="moon" size={14} /> {t('hours.night')}
              </span>
            )}
          </div>
        </div>
        <div className="session-figures">
          {s.flag === 'in_progress' && <span className="tag">{t('hours.inProgress')}</span>}
          {s.flag === 'missed_check_out' && <span className="tag tag-warn">{t('hours.missed')}</span>}
          {s.end && (
            <>
              <span className="num">{duration(s.payableMinutes)}</span>
              {s.breakMinutes > 0 && <span className="muted small">{t('hours.break', { m: s.breakMinutes })}</span>}
              {s.overtimeMinutes > 0 && (
                <span className="small ot">
                  {t('hours.overtime')} {duration(s.overtimeMinutes)}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      {s.flag === 'missed_check_out' && !sent && (
        fixing ? (
          <div className="fix-form">
            <Field id={`left-on-${s.checkInId}`} label={t('hours.leftOn')}>
              <select id={`left-on-${s.checkInId}`} value={leftOn} onChange={(e) => setLeftOn(e.target.value)}>
                <option value={s.date}>{date(s.date)}</option>
                <option value={addDays(s.date, 1)}>{date(addDays(s.date, 1))}</option>
              </select>
            </Field>
            <Field id={`left-at-${s.checkInId}`} label={t('hours.leftAt')}>
              <input id={`left-at-${s.checkInId}`} type="time" value={leftAt} onChange={(e) => setLeftAt(e.target.value)} required />
            </Field>
            {err && <p className="error" role="alert">{err}</p>}
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={!leftAt} onClick={send}>
                {t('common.submit')}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setFixing(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setFixing(true)}>
            {t('hours.fixShift')}
          </button>
        )
      )}
      {sent && <Notice tone="good">{t('hours.sent')}</Notice>}
    </li>
  );
}
