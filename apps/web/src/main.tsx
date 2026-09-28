import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// The tokens and the base styles first, so every screen's own module is read after them.
import './theme/tokens.css';
import './theme/base.css';
import { App } from './App.js';
import { markPage } from './editor/editing-storage.js';
import { applyTheme } from './theme/themes.js';

applyTheme('light');
// As the page loads, before anything is edited: a tab duplicated from one editing is told apart from
// a reload, and uses no session the tab it was copied from is using (final review of W11.3, D1).
markPage();

const container = document.getElementById('root');
if (container === null) throw new Error('index.html is missing its #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
