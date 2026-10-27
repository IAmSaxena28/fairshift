import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { I18nProvider } from './i18n/i18n.tsx';
import { RouterProvider } from './router.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </RouterProvider>
  </StrictMode>,
);
