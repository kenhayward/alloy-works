import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// The tokens and the base styles first, so every screen's own module is read after them.
import './theme/tokens.css';
import './theme/base.css';
import { App } from './App.js';
import { applyTheme } from './theme/themes.js';

applyTheme('light');

const container = document.getElementById('root');
if (container === null) throw new Error('index.html is missing its #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
