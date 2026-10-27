import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { LanguageSwitch, useData } from '../components/ui.tsx';
import { useI18n } from '../i18n/i18n.tsx';
import { Link } from '../router.tsx';

interface DemoAccounts {
  password: string;
  accounts: Array<{ username: string; name: string; job_title: string; role: string; org: string; industry: string }>;
}

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const { t } = useI18n();
  const demo = useData(() => api.get<DemoAccounts>('/api/demo/accounts'), []);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async (u: string, p: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { username: u, password: p });
      onSignedIn();
    } catch (e) {
      setError((e as ApiError).status === 401 ? t('login.failed') : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void signIn(username, password);
  };

  const groups = new Map<string, DemoAccounts['accounts']>();
  for (const a of demo.data?.accounts ?? []) groups.set(a.org, [...(groups.get(a.org) ?? []), a]);

  return (
    <div className="login">
      <header className="login-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            F
          </span>
          <div className="brand-name">{t('app.name')}</div>
        </div>
        <LanguageSwitch />
      </header>
      <main id="main" className="login-main">
        <p className="tagline">{t('app.tagline')}</p>

        {demo.data && (
          <section aria-labelledby="demo-title" className="card">
            <h2 id="demo-title">{t('login.demoTitle')}</h2>
            <p className="hint">{t('login.demoHint', { password: demo.data.password })}</p>
            {[...groups.entries()].map(([org, accounts]) => (
              <div key={org} className="demo-group">
                <h3>
                  <Icon name={accounts[0]!.industry === 'construction' ? 'hardhat' : 'users'} size={18} /> {org}
                </h3>
                <div className="demo-accounts">
                  {accounts.map((a) => (
                    <button
                      key={a.username}
                      type="button"
                      className="demo-account"
                      disabled={busy}
                      onClick={() => signIn(a.username, demo.data!.password)}
                      data-username={a.username}
                    >
                      <strong>{a.name}</strong>
                      <span className="muted small">
                        {a.job_title} · {a.role === 'admin' ? 'Employer' : 'Worker'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        <section aria-labelledby="login-title" className="card">
          <h2 id="login-title">{t('login.title')}</h2>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="username">{t('login.username')}</label>
              <input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="password">{t('login.password')}</label>
              <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {t('login.submit')}
            </button>
          </form>
        </section>

        <nav className="login-links" aria-label="Without signing in">
          <Link to="/report/STHAPATI">
            <Icon name="lock" size={18} /> {t('login.reportLink')}
          </Link>
          <Link to="/track">
            <Icon name="list" size={18} /> {t('login.trackLink')}
          </Link>
        </nav>
        <p className="demo-note">{t('common.demoData')}</p>
      </main>
    </div>
  );
}
