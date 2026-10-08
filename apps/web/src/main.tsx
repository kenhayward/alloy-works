import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// The tokens and the base styles first, so every screen's own module is read after them.
import './theme/tokens.css';
import './theme/base.css';
import { App } from './App.js';
import { themeStore } from './theme/themes.js';

// The kept theme, or Auto, applied before anything renders, so Dark never opens as Light (LG-B).
themeStore();

const container = document.getElementById('root');
if (container === null) throw new Error('index.html is missing its #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
