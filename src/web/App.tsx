import { useEffect } from 'react';
import { api } from './api.ts';
import { ErrorNote, Loading, useData } from './components/ui.tsx';
import { I18nProvider } from './i18n/i18n.tsx';
import { match, useRouter } from './router.tsx';
import type { Me } from './types.ts';
import { AdminApp } from './pages/admin/AdminApp.tsx';
import { LoginPage } from './pages/Login.tsx';
import { PublicReportPage, TrackPage } from './pages/PublicPages.tsx';
import { WorkerApp } from './pages/worker/WorkerApp.tsx';

function Authenticated() {
  const { path, navigate } = useRouter();
  const me = useData(() => api.get<Me>('/api/me'), []);

  const role = me.data?.user.role;
  useEffect(() => {
    if (role === 'worker' && !path.startsWith('/w')) navigate('/w');
    if (role === 'admin' && !path.startsWith('/a')) navigate('/a');
  }, [role, path, navigate]);

  if (me.loading && !me.data) return <Loading />;
  if (me.error?.status === 401 || !me.data) {
    if (me.error && me.error.status !== 401) return <ErrorNote error={me.error} onRetry={me.reload} />;
    return <LoginPage onSignedIn={me.reload} />;
  }

  const signOut = async () => {
    await api.post('/api/auth/logout');
    navigate('/');
    me.reload();
  };

  return (
    <I18nProvider timeZone={me.data.org.timeZone}>
      {me.data.user.role === 'worker' ? <WorkerApp me={me.data} onSignOut={signOut} /> : <AdminApp me={me.data} onSignOut={signOut} />}
    </I18nProvider>
  );
}

export function App() {
  const { path } = useRouter();
  let params: Record<string, string> | null;
  if ((params = match('/report/:org', path))) return <PublicReportPage orgCode={params.org!} />;
  if (match('/track', path)) return <TrackPage />;
  return <Authenticated />;
}
