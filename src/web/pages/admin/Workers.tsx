import { api } from '../../api.ts';
import { ErrorNote, Loading, Pill, useData } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/i18n.tsx';
import { Link } from '../../router.tsx';
import { localDateKey, periodOf, previousPeriod } from '../../../shared/time.ts';
import type { FatigueWarning, SessionCalc } from '../../../shared/types.ts';
import type { Me, PayData } from '../../types.ts';
import { FairnessReplay } from '../worker/FairnessReplay.tsx';
import { FATIGUE_LABEL } from './labels.ts';

interface WorkerRow {
  id: number;
  name: string;
  jobTitle: string;
  site: string | null;
  basis: 'hourly' | 'monthly';
  ratePaise: number;
  last7DaysMinutes: number;
  checkedIn: boolean;
  fatigueWarnings: number;
  missedCheckOuts: number;
  payStatus: 'match' | 'underpaid' | 'overpaid' | null;
  payDifferencePaise: number | null;
}

export function WorkersPage() {
  const { money, duration } = useI18n();
  const { data, error, loading, reload } = useData(() => api.get<WorkerRow[]>('/api/admin/workers'), []);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote error={error!} onRetry={reload} />;
  return (
    <>
      <h1>Workforce</h1>
      <p className="muted">Recorded facts only: hours, rule breaches and pay checks. FairShift does not score or rank people.</p>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Workers with hours in the last 7 days and last month's pay check</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Site</th>
              <th scope="col">Pay</th>
              <th scope="col" className="num">Last 7 days</th>
              <th scope="col">Warnings</th>
              <th scope="col">Last month's pay</th>
            </tr>
          </thead>
          <tbody>
            {data.map((w) => (
              <tr key={w.id}>
                <td>
                  <Link to={`/a/workers/${w.id}`}>{w.name}</Link>
                  <div className="muted small">
                    {w.jobTitle}
                    {w.checkedIn && ' · on shift now'}
                  </div>
                </td>
                <td>{w.site}</td>
                <td className="num">{w.basis === 'hourly' ? `${money(w.ratePaise)}/h` : `${money(w.ratePaise)}/mo`}</td>
                <td className="num">{duration(w.last7DaysMinutes)}</td>
                <td>
                  {w.fatigueWarnings > 0 && <Pill status="overpaid">{w.fatigueWarnings} rest</Pill>}{' '}
                  {w.missedCheckOuts > 0 && <Pill status="open">{w.missedCheckOuts} no check-out</Pill>}
                </td>
                <td>
                  {w.payStatus && (
                    <Pill status={w.payStatus}>
                      {w.payStatus === 'match' ? 'Matches records' : `${money(Math.abs(w.payDifferencePaise!))} ${w.payStatus}`}
                    </Pill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface WorkerDetailData {
  worker: { id: number; name: string; jobTitle: string };
  sessions: SessionCalc[];
  fatigue: FatigueWarning[];
}

export function WorkerDetail({ id, me }: { id: number; me: Me }) {
  const { time, date, duration } = useI18n();
  const last = previousPeriod(periodOf(localDateKey(Date.now(), me.org.timeZone)));
  const detail = useData(() => api.get<WorkerDetailData>(`/api/admin/workers/${id}`), [id]);
  const pay = useData(() => api.get<PayData>(`/api/admin/workers/${id}/pay/${last}`), [id, last]);
  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error || !detail.data) return <ErrorNote error={detail.error!} />;
  const d = detail.data;
  return (
    <>
      <Link to="/a/workers" className="back">
        ← Workforce
      </Link>
      <h1>{d.worker.name}</h1>
      <p className="muted">{d.worker.jobTitle}</p>
      <div className="grid-2">
        <section className="card">
          <h2>Last 14 days</h2>
          {d.fatigue.length > 0 && (
            <ul className="plain warn-list">
              {d.fatigue.map((w, i) => (
                <li key={i}>
                  {date(w.date)}: {FATIGUE_LABEL[w.rule]} ({w.rule === 'consecutive_days' ? `${w.value} days` : duration(w.value)})
                </li>
              ))}
            </ul>
          )}
          <ul className="sessions compact">
            {d.sessions
              .slice()
              .reverse()
              .map((s) => (
                <li key={s.checkInId} className={`session ${s.flag ? `session-${s.flag}` : ''}`}>
                  <div className="session-main">
                    <span>
                      <strong>{date(s.date)}</strong> <span className="muted">{time(s.start)} – {s.end ? time(s.end) : s.flag === 'in_progress' ? 'on shift' : 'no check-out'}</span>
                    </span>
                    <span className="num">
                      {s.end ? duration(s.payableMinutes) : ''}
                      {s.overtimeMinutes > 0 && <span className="small ot"> +{duration(s.overtimeMinutes)} OT</span>}
                    </span>
                  </div>
                </li>
              ))}
          </ul>
        </section>
        <section className="card">{pay.data ? <FairnessReplay data={pay.data} orgName={me.org.name} readOnly /> : pay.error ? <ErrorNote error={pay.error} /> : <Loading />}</section>
      </div>
    </>
  );
}
