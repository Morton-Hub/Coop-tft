import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Dans l'app Android (Capacitor) les fichiers sont déjà embarqués : pas de service worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !('Capacitor' in window)) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
