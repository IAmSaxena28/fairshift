import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { Link, match, useRouter } from '../../router.tsx';
import type { Me } from '../../types.ts';
import { AuditPage } from './Audit.tsx';
import { CorrectionDetail, CorrectionsPage } from './Corrections.tsx';
import { OverviewPage } from './Overview.tsx';
import { PolicyPage } from './Policy.tsx';
import { SafetyDetail, SafetyPage } from './Safety.tsx';
import { ShiftsPage } from './Shifts.tsx';
import { WorkerDetail, WorkersPage } from './Workers.tsx';

const NAV: Array<{ to: string; icon: IconName; label: string }> = [
  { to: '/a', icon: 'home', label: 'Overview' },
  { to: '/a/workers', icon: 'users', label: 'Workforce' },
  { to: '/a/shifts', icon: 'calendar', label: 'Shifts' },
  { to: '/a/corrections', icon: 'rupee', label: 'Pay & time requests' },
  { to: '/a/safety', icon: 'shield', label: 'Safety & grievances' },
  { to: '/a/policy', icon: 'settings', label: 'Pay rules' },
  { to: '/a/audit', icon: 'log', label: 'Audit trail' },
];

export function AdminApp({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const { path } = useRouter();
  let page: ReactNode;
  let p: Record<string, string> | null;
  if ((p = match('/a/workers/:id', path))) page = <WorkerDetail id={Number(p.id)} me={me} />;
  else if (match('/a/workers', path)) page = <WorkersPage />;
  else if (match('/a/shifts', path)) page = <ShiftsPage />;
  else if ((p = match('/a/corrections/:id', path))) page = <CorrectionDetail id={Number(p.id)} me={me} />;
  else if (match('/a/corrections', path)) page = <CorrectionsPage />;
  else if ((p = match('/a/safety/:id', path))) page = <SafetyDetail id={Number(p.id)} />;
  else if (match('/a/safety', path)) page = <SafetyPage />;
  else if (match('/a/policy', path)) page = <PolicyPage />;
  else if (match('/a/audit', path)) page = <AuditPage />;
  else page = <OverviewPage me={me} />;

  const pathname = path.split('?')[0]!;
  const active = NAV.slice()
    .reverse()
    .find((n) => (n.to === '/a' ? pathname === '/a' : pathname.startsWith(n.to)))?.to;

  return (
    <div className="admin-app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="admin-nav">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            F
          </span>
          <div>
            <div className="brand-name">FairShift</div>
            <div className="brand-org">{me.org.name}</div>
          </div>
        </div>
        <nav aria-label="Employer">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={active === n.to ? 'nav-item active' : 'nav-item'} aria-current={active === n.to ? 'page' : undefined}>
              <Icon name={n.icon} size={20} />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="admin-user">
          <div>
            <strong>{me.user.name}</strong>
            <div className="muted small">{me.user.jobTitle}</div>
          </div>
          <button type="button" className="icon-btn" onClick={onSignOut} aria-label="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <main id="main" className="admin-main" tabIndex={-1}>
        {page}
        <p className="demo-note">Demo data. All people, places and incidents are fictional.</p>
      </main>
    </div>
  );
}
