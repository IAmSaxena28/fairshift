import { useState } from 'react';
import { api, ApiError } from '../../api.ts';
import { Icon } from '../../components/Icon.tsx';
import { ErrorNote, Loading, Notice, Pill, StatTile, useData } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/i18n.tsx';
import { Link } from '../../router.tsx';
import type { Me, TodayData } from '../../types.ts';
import { FatigueList } from './Hours.tsx';

export function TodayPage({ me }: { me: Me }) {
  const { t, time, duration, date, money, month } = useI18n();
  const { data, error, loading, reload } = useData(() => api.get<TodayData>('/api/worker/today'), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote error={error!} onRetry={reload} />;

  const toggle = async () => {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      if (data.checkedIn) {
        const res = await api.post<{ minutes: number }>('/api/worker/check-out');
        setMessage(t('today.checkedOutDone', { duration: duration(res.minutes) }));
      } else {
        await api.post('/api/worker/check-in');
        setMessage(t('today.checkedInDone'));
      }
      reload();
    } catch (e) {
      setActionError(e as ApiError);
      reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>{t('today.greeting', { name: me.user.name.split(' ')[0]! })}</h1>

      <section className="card shift-card" aria-labelledby="shift-title">
        <h2 id="shift-title" className="card-title">
          {t('today.shift')}
        </h2>
        {data.shift ? (
          <p className="shift-time">
            {time(data.shift.startAt)} – {time(data.shift.endAt)}
            {data.shift.site && <span className="muted"> · {data.shift.site}</span>}
          </p>
        ) : (
          <p className="muted">{t('today.noShift')}</p>
        )}
        <p className="checkin-state" role="status">
          <span className={`dot ${data.checkedIn ? 'dot-on' : ''}`} aria-hidden="true" />
          {data.checkedIn ? t('today.checkedInSince', { time: time(data.checkedIn.since) }) : t('today.notCheckedIn')}
        </p>
        <button type="button" className={`btn btn-huge ${data.checkedIn ? 'btn-secondary' : 'btn-primary'}`} onClick={toggle} disabled={busy} aria-busy={busy}>
          <Icon name={data.checkedIn ? 'logout' : 'check'} size={28} />
          {data.checkedIn ? t('today.checkOut') : t('today.checkIn')}
        </button>
        {message && <Notice tone="good">{message}</Notice>}
        {actionError && <ErrorNote error={actionError} />}
      </section>

      <div className="stats">
        <StatTile label={t('today.workedToday')} value={duration(data.minutesToday)} />
        <StatTile label={t('today.thisWeek')} value={duration(data.weekMinutes)} />
      </div>

      {data.missedCheckOuts.map((m) => (
        <Notice key={m.checkInId} tone="warn" icon="alert">
          <strong>{t('today.missedTitle')}</strong>
          <p>{t('today.missedBody', { date: date(m.date) })}</p>
          <Link to={`/w/hours?period=${m.date.slice(0, 7)}`} className="btn btn-secondary">
            {t('today.missedAction')}
          </Link>
        </Notice>
      ))}

      <FatigueList warnings={data.fatigue} />

      <nav className="big-links" aria-label="Shortcuts">
        <Link to="/w/pay" className="big-link">
          <Icon name="rupee" size={28} />
          <span>
            <strong>{t('today.viewPay')}</strong>
            {data.latestPay && (
              <span className="muted">
                {t('today.latestPay')}: {month(data.latestPay.period)} · <span className="num">{money(data.latestPay.grossPaise)}</span>{' '}
                <Pill status={data.latestPay.status}>{t(`pay.status.${data.latestPay.status}`)}</Pill>
              </span>
            )}
          </span>
        </Link>
        <Link to="/w/help" className="big-link">
          <Icon name="alert" size={28} />
          <span>
            <strong>{t('today.report')}</strong>
            {data.openCases > 0 && (
              <span className="muted">
                {t('today.openCases')}: {data.openCases}
              </span>
            )}
          </span>
        </Link>
      </nav>
    </>
  );
}
