import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MinderProvider } from '@minder/react';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MinderProvider url="ws://127.0.0.1:7331/app">
      <App />
    </MinderProvider>
  </StrictMode>,
);
