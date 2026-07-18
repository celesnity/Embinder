import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EmbinderProvider } from '@embinder/react';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EmbinderProvider url="ws://127.0.0.1:7331/app" viz chat={{ baseURL: 'http://127.0.0.1:1234/v1', model: 'qwen2.5-7b-instruct' }}>
      <App />
    </EmbinderProvider>
  </StrictMode>,
);
