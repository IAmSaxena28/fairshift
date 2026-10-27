import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatINR } from '../../shared/money.ts';
import type { Lang } from '../../shared/types.ts';
import { en, type MessageKey } from './en.ts';
import { hi } from './hi.ts';
import { ta } from './ta.ts';

const dictionaries = { en, ta, hi } as const;
export const LANGS: Array<{ code: Lang; label: string; short: string }> = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'ta', label: 'தமிழ்', short: 'த' },
  { code: 'hi', label: 'हिन्दी', short: 'हि' },
];
const LOCALES: Record<Lang, string> = { en: 'en-IN', ta: 'ta-IN', hi: 'hi-IN' };
const STORAGE_KEY = 'fairshift.lang';

type Vars = Record<string, string | number>;

export interface I18n {
  lang: Lang;
  locale: string;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  money: (paise: number) => string;
  duration: (minutes: number) => string;
  date: (dateKey: string) => string;
  time: (instant: number) => string;
  /** Calendar day of an instant in the organisation's time zone. */
  day: (instant: number) => string;
  month: (periodId: string) => string;
}

const Ctx = createContext<I18n | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ta' || saved === 'hi') return saved;
  } catch {
    // Storage can be unavailable (private mode); fall back to the browser language.
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return nav.startsWith('ta') ? 'ta' : nav.startsWith('hi') ? 'hi' : 'en';
}

export function I18nProvider({ children, timeZone = 'Asia/Kolkata' }: { children: ReactNode; timeZone?: string }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore: the choice still applies for this visit.
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const locale = LOCALES[lang];
    const dict = dictionaries[lang];
    const t = (key: MessageKey, vars?: Vars) =>
      (dict[key] ?? en[key]).replace(/\{(\w+)\}/g, (_, name: string) => (vars && name in vars ? String(vars[name]) : `{${name}}`));
    const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' });
    const timeFmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
    const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone });
    const monthFmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return {
      lang,
      locale,
      setLang,
      t,
      money: (paise) => formatINR(paise, locale),
      duration: (minutes) => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        if (h === 0) return t('common.minutes', { m });
        return m === 0 ? t('common.hours', { h }) : t('common.hoursMinutes', { h, m });
      },
      date: (dateKey) => dateFmt.format(new Date(`${dateKey}T00:00:00Z`)),
      time: (instant) => timeFmt.format(new Date(instant)),
      day: (instant) => dayFmt.format(new Date(instant)),
      month: (periodId) => monthFmt.format(new Date(`${periodId}-01T00:00:00Z`)),
    };
  }, [lang, setLang, timeZone]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
