import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api.ts';
import { ErrorNote, Loading, Notice, useData } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/i18n.tsx';
import { addDays } from '../../../shared/time.ts';

interface ShiftRow {
  id: number;
  userId: number;
  worker: string;
  site: string | null;
  startAt: number;
  endAt: number;
}

export function ShiftsPage() {
  const { time, date: fmtDate } = useI18n();
  const workers = useData(() => api.get<Array<{ id: number; name: string }>>('/api/admin/workers'), []);
  const [date, setDate] = useState<string | null>(null);
  const shifts = useData(() => api.get<{ date: string; shifts: ShiftRow[] }>(`/api/admin/shifts${date ? `?date=${date}` : ''}`), [date]);
  const [form, setForm] = useState({ userId: '', start: '08:00', end: '16:00' });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const shown = shifts.data?.date ?? date ?? '';

  const assign = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api.post('/api/admin/shifts', { userId: Number(form.userId), date: shown, start: form.start, end: form.end });
      setMessage('Shift assigned.');
      shifts.reload();
    } catch (err) {
      setError(err as ApiError);
    }
  };

  return (
    <>
      <h1>Shifts</h1>
      <div className="row">
        <button type="button" className="btn btn-quiet" onClick={() => setDate(addDays(shown, -1))} disabled={!shown}>
          ← Previous day
        </button>
        <strong>{shown && fmtDate(shown)}</strong>
        <button type="button" className="btn btn-quiet" onClick={() => setDate(addDays(shown, 1))} disabled={!shown}>
          Next day →
        </button>
      </div>
      <div className="grid-2">
        <section className="card">
          <h2>Scheduled ({shifts.data?.shifts.length ?? 0})</h2>
          {shifts.loading && !shifts.data ? (
            <Loading />
          ) : shifts.error ? (
            <ErrorNote error={shifts.error} />
          ) : (
            <ul className="plain shift-list">
              {shifts.data!.shifts.map((s) => (
                <li key={s.id}>
                  <strong>{s.worker}</strong>{' '}
                  <span className="muted">
                    {time(s.startAt)} – {time(s.endAt)} · {s.site}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Assign a shift on this day</h2>
          <form onSubmit={assign}>
            <div className="field">
              <label htmlFor="shift-worker">Worker</label>
              <select id="shift-worker" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} required>
                <option value="">Choose…</option>
                {workers.data?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="shift-start">Start</label>
                <input id="shift-start" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} required />
              </div>
              <div className="field">
                <label htmlFor="shift-end">End (earlier than start means next day)</label>
                <input id="shift-end" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} required />
              </div>
            </div>
            {message && <Notice tone="good">{message}</Notice>}
            {error && <ErrorNote error={error} />}
            <button type="submit" className="btn btn-primary">
              Assign shift
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
