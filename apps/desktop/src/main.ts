import { BrowserWindow, app, ipcMain } from 'electron';
import path from 'node:path';

import {
  DEV_SERVER_URL,
  PLATFORM_INFO_CHANNEL,
  describePlatform,
  resolveRendererTarget,
} from './shell.js';

function rendererIndexHtml(): string {
  // Unpackaged, getAppPath() is apps/desktop, so its sibling is the renderer's build output.
  return path.join(app.getAppPath(), '..', 'web', 'dist', 'index.html');
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      // The renderer is untrusted. It gets a narrow, enumerated preload surface and nothing else.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  window.once('ready-to-show', () => window.show());

  const target = resolveRendererTarget({
    packaged: app.isPackaged,
    devServerUrl: DEV_SERVER_URL,
    rendererIndexHtml: rendererIndexHtml(),
  });

  if (target.kind === 'url') {
    void window.loadURL(target.value);
  } else {
    void window.loadFile(target.value);
  }
}

ipcMain.handle(PLATFORM_INFO_CHANNEL, () => describePlatform(process.versions));

void app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // macOS keeps the app alive with no windows; every other platform expects it to exit.
  if (process.platform !== 'darwin') app.quit();
});
