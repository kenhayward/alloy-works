import { BrowserWindow, Menu, Tray, app, ipcMain, nativeTheme } from 'electron';
import path from 'node:path';

import {
  APP_USER_MODEL_ID,
  rendererIndexHtml,
  resolveTrayVariant,
  trayIconPath,
  windowIconPath,
} from './icons.js';
import {
  DEV_SERVER_URL,
  PLATFORM_INFO_CHANNEL,
  describePlatform,
  resolveRendererTarget,
} from './shell.js';

// Windows reads this to decide which icon a taskbar button, jump list or toast notification
// belongs to. It has to be set before the first window is created.
app.setAppUserModelId(APP_USER_MODEL_ID);

// Module scope on purpose: a Tray that only a local variable refers to is garbage collected,
// and the icon vanishes from the tray some seconds after startup.
let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    // Windows and Linux take the window icon from here. macOS ignores it and uses the bundle.
    icon: windowIconPath(app.getAppPath()),
    webPreferences: {
      // The renderer is untrusted. It gets a narrow, enumerated preload surface and nothing else.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    mainWindow = null;
  });

  const target = resolveRendererTarget({
    packaged: app.isPackaged,
    devServerUrl: DEV_SERVER_URL,
    rendererIndexHtml: rendererIndexHtml(app.getAppPath(), app.isPackaged),
    serviceUrl: process.env.ALLOY_SERVICE_URL,
  });

  if (target.kind === 'url') {
    void window.loadURL(target.value);
  } else {
    void window.loadFile(target.value);
  }

  mainWindow = window;
}

function showWindow(): void {
  if (mainWindow === null) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function currentTrayIcon(): string {
  return trayIconPath(
    app.getAppPath(),
    resolveTrayVariant(process.platform, nativeTheme.shouldUseDarkColors),
  );
}

function createTray(): void {
  tray = new Tray(currentTrayIcon());
  tray.setToolTip('Alloy Works');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Alloy Works', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' },
    ]),
  );
  tray.on('click', showWindow);

  // Windows and Linux cannot invert the glyph themselves, so follow the system theme and swap
  // the file. On macOS this recomputes to the same template image and costs nothing.
  nativeTheme.on('updated', () => tray?.setImage(currentTrayIcon()));
}

ipcMain.handle(PLATFORM_INFO_CHANNEL, () => describePlatform(process.versions));

void app.whenReady().then(() => {
  // Unpackaged on macOS the Dock shows Electron's icon, because there is no bundle to read one
  // from. Packaged, the bundle wins and this is a no-op.
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(windowIconPath(app.getAppPath()));
  }

  app.setAboutPanelOptions({
    applicationName: 'Alloy Works',
    applicationVersion: app.getVersion(),
    iconPath: windowIconPath(app.getAppPath()),
  });

  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // macOS keeps the app alive with no windows; every other platform expects it to exit.
  if (process.platform !== 'darwin') app.quit();
});
