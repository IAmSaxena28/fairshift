import { useEffect, type ReactNode } from 'react';
import { api } from '../../api.ts';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { LanguageSwitch } from '../../components/ui.tsx';
import { hasStoredLang, isLang, useI18n } from '../../i18n/i18n.tsx';
import type { Lang } from '../../../shared/types.ts';
import { Link, match, useRouter } from '../../router.tsx';
import type { Me } from '../../types.ts';
import type { MessageKey } from '../../i18n/en.ts';
import { HelpPage } from './Help.tsx';
import { HoursPage } from './Hours.tsx';
import { PayPage } from './Pay.tsx';
import { TodayPage } from './Today.tsx';

const TABS: Array<{ to: string; icon: IconName; label: MessageKey }> = [
  { to: '/w', icon: 'home', label: 'nav.today' },
  { to: '/w/hours', icon: 'clock', label: 'nav.hours' },
  { to: '/w/pay', icon: 'rupee', label: 'nav.pay' },
  { to: '/w/help', icon: 'help', label: 'nav.help' },
];

export function WorkerApp({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const { t, setLang } = useI18n();
  const { path } = useRouter();

  // On a new phone, start in the language the worker chose before. Afterwards each choice is saved to the account.
  useEffect(() => {
    if (!hasStoredLang() && isLang(me.user.lang)) setLang(me.user.lang);
  }, [me.user.lang, setLang]);
  const saveLang = (lang: Lang) => {
    api.put('/api/me/preferences', { lang }).catch(() => {
      // The choice still applies on this device; saving it to the account can wait for the next change.
    });
  };

  let page: ReactNode;
  let params: Record<string, string> | null;
  if (match('/w/hours', path)) page = <HoursPage me={me} />;
  else if ((params = match('/w/pay/:period', path))) page = <PayPage me={me} period={params.period!} />;
  else if (match('/w/pay', path)) page = <PayPage me={me} />;
  else if (match('/w/help', path)) page = <HelpPage me={me} />;
  else page = <TodayPage me={me} />;

  const active = TABS.slice()
    .reverse()
    .find((tab) => path.split('?')[0]!.startsWith(tab.to))?.to;

  return (
    <div className="worker-app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="worker-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            F
          </span>
          <div>
            <div className="brand-name">{t('app.name')}</div>
            <div className="brand-org">{me.org.name}</div>
          </div>
        </div>
        <div className="header-actions">
          <LanguageSwitch onChange={saveLang} />
          <button type="button" className="icon-btn" onClick={onSignOut} aria-label={t('common.signOut')}>
            <Icon name="logout" />
          </button>
        </div>
      </header>
      <main id="main" className="worker-main" tabIndex={-1}>
        {page}
        <p className="demo-note">{t('common.demoData')}</p>
      </main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((tab) => (
          <Link key={tab.to} to={tab.to} className={active === tab.to ? 'tab active' : 'tab'} aria-current={active === tab.to ? 'page' : undefined}>
            <Icon name={tab.icon} />
            <span>{t(tab.label)}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
