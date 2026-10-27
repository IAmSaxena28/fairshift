import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { LanguageSwitch } from '../../components/ui.tsx';
import { useI18n } from '../../i18n/i18n.tsx';
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
  const { t } = useI18n();
  const { path } = useRouter();

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
          <LanguageSwitch />
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
