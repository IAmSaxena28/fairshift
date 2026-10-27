import { api } from '../../api.ts';
import { Icon } from '../../components/Icon.tsx';
import { ErrorNote, Loading, StatTile, useData } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/i18n.tsx';
import { Link } from '../../router.tsx';
import type { FatigueWarning } from '../../../shared/types.ts';
import type { Me } from '../../types.ts';
import { CATEGORY_LABEL, FATIGUE_LABEL } from './labels.ts';

type Action =
  | { type: 'urgent_case'; caseId: number; category: string; site: string | null; createdOn: string }
  | { type: 'correction'; caseId: number; worker: string; kind: 'pay' | 'attendance'; status: string; since: number }
  | { type: 'discrepancy'; userId: number; worker: string; period: string; differencePaise: number }
  | { type: 'missed_check_out'; userId: number; worker: string; date: string }
  | { type: 'fatigue'; userId: number; worker: string; warning: FatigueWarning };

interface Dashboard {
  org: { name: string; industry: string };
  today: string;
  workforce: { workers: number; scheduledToday: number; checkedInNow: number; missedCheckOuts: number };
  pay: { period: string; checked: number; matching: number; discrepancies: number; underpaidPaise: number; openCorrections: number };
  safety: { open: number; urgentOpen: number; overdue: number; medianDaysToResolve: number | null; byCategory: Array<{ category: string; open: number; resolved: number }> };
  hours: { week: string; bySite: Array<{ site: string; workers: number; payableMinutes: number; overtimeMinutes: number }>; fatigueCounts: Record<string, number> };
  actions: Action[];
}

/** Horizontal bars drawn in HTML: each row shows its label and exact value as text. */
function Bars({ rows, format, label }: { rows: Array<{ key: string; label: string; value: number; note?: string }>; format: (v: number) => string; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${format(r.value)}`}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="bar-value num">
            {format(r.value)}
            {r.note && <span className="muted small"> {r.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ActionRow({ a }: { a: Action }) {
  const { money, date, duration } = useI18n();
  switch (a.type) {
    case 'urgent_case':
      return (
        <Link to={`/a/safety/${a.caseId}`} className="action action-danger">
          <Icon name="alert" />
          <span>
            <strong>Urgent {CATEGORY_LABEL[a.category]?.toLowerCase()} report</strong> {a.site ? `at ${a.site}` : ''} since {date(a.createdOn)}. Needs a person to acknowledge it.
          </span>
        </Link>
      );
    case 'correction':
      return (
        <Link to={`/a/corrections/${a.caseId}`} className="action">
          <Icon name="rupee" />
          <span>
            <strong>{a.worker}</strong> asked for a {a.kind === 'pay' ? 'pay check' : 'shift time fix'} ({a.status.replace('_', ' ')}).
          </span>
        </Link>
      );
    case 'discrepancy':
      return (
        <Link to={`/a/workers/${a.userId}`} className="action action-warn">
          <Icon name="scale" />
          <span>
            <strong>{a.worker}</strong>: payroll is {money(Math.abs(a.differencePaise))} {a.differencePaise > 0 ? 'below' : 'above'} what attendance records support.
          </span>
        </Link>
      );
    case 'missed_check_out':
      return (
        <Link to={`/a/workers/${a.userId}`} className="action">
          <Icon name="clock" />
          <span>
            <strong>{a.worker}</strong> has no check-out for {date(a.date)}; that shift is unpaid until fixed.
          </span>
        </Link>
      );
    case 'fatigue':
      return (
        <Link to={`/a/workers/${a.userId}`} className="action">
          <Icon name="moon" />
          <span>
            <strong>{a.worker}</strong>: {FATIGUE_LABEL[a.warning.rule]} on {date(a.warning.date)} (
            {a.warning.rule === 'consecutive_days' ? `${a.warning.value} days` : duration(a.warning.value)}, limit{' '}
            {a.warning.rule === 'consecutive_days' ? a.warning.limit : duration(a.warning.limit)}).
          </span>
        </Link>
      );
  }
}

export function OverviewPage({ me }: { me: Me }) {
  const { money, month } = useI18n();
  const { data, error, loading, reload } = useData(() => api.get<Dashboard>('/api/admin/dashboard'), []);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote error={error!} onRetry={reload} />;

  const hours = (m: number) => `${(m / 60).toFixed(1)} h`;
  const priority = data.actions.filter((a) => a.type !== 'fatigue');
  const fatigue = data.actions.filter((a) => a.type === 'fatigue');

  return (
    <>
      <h1>{me.org.name}</h1>
      <p className="muted">
        {me.org.industry === 'construction' ? 'Construction' : 'College facilities'} · every figure below is computed from stored records when this page loads.
      </p>

      <section aria-labelledby="needs-action" className="card">
        <h2 id="needs-action">Needs action ({priority.length})</h2>
        {priority.length === 0 ? <p className="muted">Nothing waiting.</p> : <div className="actions">{priority.map((a, i) => <ActionRow key={i} a={a} />)}</div>}
        {fatigue.length > 0 && (
          <details>
            <summary>Rest and working-time warnings ({fatigue.length})</summary>
            <div className="actions">{fatigue.map((a, i) => <ActionRow key={i} a={a} />)}</div>
          </details>
        )}
      </section>

      <div className="stats stats-4">
        <StatTile label="Checked in now" value={`${data.workforce.checkedInNow} / ${data.workforce.scheduledToday}`} sub="scheduled today" />
        <StatTile
          label={`Pay checked, ${month(data.pay.period)}`}
          value={`${data.pay.matching} of ${data.pay.checked} match`}
          sub={data.pay.discrepancies ? `${money(data.pay.underpaidPaise)} owed per records` : 'no gaps'}
          tone={data.pay.discrepancies ? 'warn' : 'good'}
        />
        <StatTile label="Open safety cases" value={data.safety.open} sub={`${data.safety.urgentOpen} urgent · ${data.safety.overdue} overdue`} tone={data.safety.overdue ? 'danger' : undefined} />
        <StatTile label="Median days to close a case" value={data.safety.medianDaysToResolve ?? 'n/a'} sub="resolved cases" />
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="ot-title">
          <h2 id="ot-title">Overtime this week by site</h2>
          <Bars
            label="Overtime hours this week by site"
            rows={data.hours.bySite.map((s) => ({ key: s.site, label: s.site, value: s.overtimeMinutes, note: `of ${hours(s.payableMinutes)}` }))}
            format={hours}
          />
        </section>
        <section className="card" aria-labelledby="cat-title">
          <h2 id="cat-title">Safety and grievance reports by type</h2>
          <Bars
            label="Reports by type"
            rows={data.safety.byCategory.map((c) => ({ key: c.category, label: CATEGORY_LABEL[c.category] ?? c.category, value: c.open + c.resolved, note: `${c.open} open` }))}
            format={(v) => String(v)}
          />
          <p className="hint">Counts only. Confidential reports never show who filed them.</p>
        </section>
      </div>
    </>
  );
}
