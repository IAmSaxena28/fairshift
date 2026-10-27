import { api } from '../../api.ts';
import { ErrorNote, Loading, useData } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/i18n.tsx';
import { useRouter } from '../../router.tsx';
import type { Me, PayData } from '../../types.ts';
import { FairnessReplay } from './FairnessReplay.tsx';

export function PayPage({ me, period }: { me: Me; period?: string }) {
  const { t, month } = useI18n();
  const { navigate } = useRouter();
  const months = useData(() => api.get<{ current: string; previous: string }>('/api/worker/pay'), []);
  const selected = period ?? months.data?.previous;
  const pay = useData(() => (selected ? api.get<PayData>(`/api/worker/pay/${selected}`) : new Promise<PayData>(() => {})), [selected]);

  return (
    <>
      <h1>{t('pay.title')}</h1>
      {months.data && (
        <div className="field">
          <label htmlFor="pay-month">{t('pay.month')}</label>
          <select id="pay-month" value={selected} onChange={(e) => navigate(`/w/pay/${e.target.value}`)}>
            {[months.data.previous, months.data.current].map((p) => (
              <option key={p} value={p}>
                {month(p)}
              </option>
            ))}
          </select>
        </div>
      )}
      {months.error && <ErrorNote error={months.error} onRetry={months.reload} />}
      {pay.error ? (
        <ErrorNote error={pay.error} onRetry={pay.reload} />
      ) : !pay.data ? (
        <Loading />
      ) : (
        <FairnessReplay data={pay.data} orgName={me.org.name} onChanged={pay.reload} />
      )}
    </>
  );
}
