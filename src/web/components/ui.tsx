import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../api.ts';
import { LANGS, useI18n } from '../i18n/i18n.tsx';
import type { Lang } from '../../shared/types.ts';
import { Icon, type IconName } from './Icon.tsx';

/** Loads data from `fetcher` and re-runs when `deps` change. `reload` refetches. */
export function useData<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fetcher().then(
      (data) => live && setState({ data, loading: false }),
      (error: ApiError) => live && setState({ error, loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

export function Loading() {
  const { t } = useI18n();
  return (
    <p className="muted" role="status">
      {t('common.loading')}
    </p>
  );
}

export function ErrorNote({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="notice notice-danger" role="alert">
      <Icon name="alert" />
      <div>
        <p>{error.status === 0 || error.status >= 500 ? t('common.error') : error.message}</p>
        {onRetry && (
          <button type="button" className="btn btn-quiet" onClick={onRetry}>
            {t('common.retry')}
          </button>
        )}
      </div>
    </div>
  );
}

export function Notice({ tone = 'info', icon = 'check', children }: { tone?: 'info' | 'good' | 'warn' | 'danger'; icon?: IconName; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

const PILL_TONE: Record<string, string> = {
  open: 'warn',
  submitted: 'warn',
  acknowledged: 'info',
  under_review: 'info',
  action_taken: 'info',
  resolved: 'good',
  match: 'good',
  underpaid: 'danger',
  overpaid: 'warn',
  paid: 'good',
  approved: 'info',
  calculated: 'neutral',
};

export function Pill({ status, children }: { status: string; children: ReactNode }) {
  return <span className={`pill pill-${PILL_TONE[status] ?? 'neutral'}`}>{children}</span>;
}

export function LanguageSwitch({ onChange }: { onChange?: (lang: Lang) => void }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t('lang.label')}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          lang={l.code}
          aria-pressed={lang === l.code}
          className={lang === l.code ? 'active' : ''}
          onClick={() => {
            setLang(l.code);
            onChange?.(l.code);
          }}
        >
          {/* The visible short form stays inside the accessible name (WCAG 2.5.3). */}
          {l.short}
          <span className="sr-only"> {l.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, id }: { label: string; hint?: string; children: ReactNode; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}

/** Reads text aloud with the browser's own voices, if the device has one for the language. */
export function ListenButton({ text }: { text: string }) {
  const { t, locale, lang } = useI18n();
  const [speaking, setSpeaking] = useState(false);
  const [noVoice, setNoVoice] = useState(false);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => () => {
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);

  if (!supported) return null;

  const speak = () => {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const voice = synth.getVoices().find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(lang));
    if (!voice) {
      setNoVoice(true);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = locale;
    u.voice = voice;
    u.rate = 0.9;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  };

  return (
    <div className="listen">
      <button type="button" className="btn btn-secondary" onClick={speak} aria-pressed={speaking}>
        <Icon name="speaker" />
        {speaking ? t('pay.stop') : t('pay.listen')}
      </button>
      {noVoice && <p className="hint" role="status">{t('pay.noVoice')}</p>}
    </div>
  );
}

export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn' | 'danger' | 'good' }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
