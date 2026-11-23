import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The two OFL fonts (PLAN §9.3, M1-T2): Press Start 2P for display, Pixelify Sans for body text.
import '@fontsource/press-start-2p/400.css';
import '@fontsource/pixelify-sans/400.css';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
