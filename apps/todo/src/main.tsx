import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GrabMyCursorProvider } from '@grabmycursor/react';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GrabMyCursorProvider url="ws://127.0.0.1:7331/app" viz>
      <App />
    </GrabMyCursorProvider>
  </StrictMode>,
);
