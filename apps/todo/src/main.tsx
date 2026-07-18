import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EmbinderProvider } from '@embinder/react';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EmbinderProvider url="ws://127.0.0.1:7331/app" viz chat={{}}>
      <App />
    </EmbinderProvider>
  </StrictMode>,
);
