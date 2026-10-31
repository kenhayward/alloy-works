import { desktopLanguage, desktopWords, isInterfaceLanguage } from '@alloy-works/web/desktop-words';
import { BrowserWindow, Menu, Tray, app, dialog, ipcMain, nativeTheme, net, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';

import { keepAddress, keptAddress } from './connection.js';
import {
  APP_USER_MODEL_ID,
  rendererIndexHtml,
  resolveTrayVariant,
  trayIconPath,
  windowIconPath,
} from './icons.js';
import {
  CONNECT_CHANNEL,
  CONNECT_ROUTE,
  DEV_SERVER_URL,
  INTERFACE_LANGUAGE_CHANNEL,
  PLATFORM_INFO_CHANNEL,
  SPELL_CHECK_LANGUAGES_CHANNEL,
  addressDecision,
  connectScreen,
  describePlatform,
  environmentAnswer,
  fill,
  isConnectScreen,
  isTrustedFrame,
  navigationDecision,
  windowOpenDecision,
  redirectDecision,
  resolveRendererTarget,
  spellCheckerChoice,
  startsAtConnect,
  spellingMenu,
  trayMenu,
  updateStep,
  updateTrayItem,
  updates,
  windowBackground,
  type RendererLocation,
  type RendererTarget,
  type UpdateAct,
  type UpdateEvent,
  type UpdateState,
} from './shell.js';

// Windows reads this to decide which icon a taskbar button, jump list or toast notification
// belongs to. It has to be set before the first window is created.
app.setAppUserModelId(APP_USER_MODEL_ID);

// Module scope on purpose: a Tray that only a local variable refers to is garbage collected,
// and the icon vanishes from the tray some seconds after startup.
let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
// Where the renderer is, once the first window has worked it out: what the navigation guard and every
// IPC handler hold a page to (issue #309). Replaced before each load, as the Connect to screen and the
// environment it connects to take turns in the one window (the DR plan, DR-A).
let rendererTarget: RendererTarget | null = null;
// The address the window's current navigation asked for, which its redirects are judged by.
let requested = '';
// The environment the window was last pointed at, which the Connect to screen shows (ADM-051).
let connectedTo: string | undefined;
// Where an update is (the DR plan, DR-H, DR-I): the decisions are shell.ts's, carried out here.
let update: UpdateState = { kind: 'idle' };

/** Where the renderer could be: the variable, the kept address, the packaged file or the dev server. */
function rendererLocation(): RendererLocation {
  return {
    packaged: app.isPackaged,
    devServerUrl: DEV_SERVER_URL,
    rendererIndexHtml: rendererIndexHtml(app.getAppPath(), app.isPackaged),
    serviceUrl: process.env.ALLOY_SERVICE_URL,
    storedUrl: keptAddress(app.getPath('userData')),
  };
}

/** Points the window at `target`, the guards first, then the load. */
function load(window: BrowserWindow, target: RendererTarget, route?: string): void {
  rendererTarget = target;
  if (target.kind === 'url') {
    requested = target.value;
    if (route === undefined && target.value !== DEV_SERVER_URL) {
      connectedTo = new URL(target.value).origin;
    }
    void window.loadURL(route === undefined ? target.value : `${target.value}#${route}`);
  } else {
    void window.loadFile(target.value, route === undefined ? {} : { hash: route });
  }
}

/** The Connect to screen in the window, saying the last address did not answer where `unreachable`. */
function showConnect(window: BrowserWindow, unreachable = false): void {
  load(
    window,
    connectScreen(rendererLocation()),
    unreachable ? `${CONNECT_ROUTE}?unreachable` : CONNECT_ROUTE,
  );
}
// The interface's language (UI-I): the system's until the renderer says, matched against the list
// once the app is ready, since `app.getLocale()` is empty before.
let language = 'en-GB';

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: windowBackground(nativeTheme.shouldUseDarkColors),
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

  // The spelling checker's suggestions (W-K): the menu is decided in shell.ts, and carried out here.
  window.webContents.on('context-menu', (_event, params) => {
    const items = spellingMenu(params, desktopWords(language));
    if (items.length === 0) return;
    Menu.buildFromTemplate(
      items.map((item) => {
        switch (item.kind) {
          case 'separator':
            return { type: 'separator' };
          case 'none':
            return { label: item.label, enabled: false };
          case 'replace':
            return {
              label: item.label,
              click: () => window.webContents.replaceMisspelling(item.text),
            };
          case 'add':
            return {
              label: item.label,
              click: () => window.webContents.session.addWordToSpellCheckerDictionary(item.word),
            };
        }
      }),
    ).popup({ window });
  });
  window.on('closed', () => {
    mainWindow = null;
  });

  const location = rendererLocation();

  // The window stays on the renderer: a link out of it opens in the system browser, and a page never
  // opens a window of its own (issue #309). The decisions are shell.ts's.
  window.webContents.on('will-navigate', (event, url) => {
    if (rendererTarget === null) return event.preventDefault();
    const decision = navigationDecision(url, window.webContents.getURL(), rendererTarget);
    if (decision.allow) {
      requested = url;
      return;
    }
    event.preventDefault();
    if (decision.openExternally) void shell.openExternal(decision.openExternally);
  });
  window.webContents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    if (!isMainFrame) return;
    if (rendererTarget === null) return event.preventDefault();
    // A load the shell began (`load`) fires no will-navigate: judged from where it was sent.
    const showing = window.webContents.getURL();
    const from = isConnectScreen(showing, connectScreen(location)) ? requested : showing;
    const decision = redirectDecision(url, requested, from, rendererTarget);
    if (decision.allow) return;
    event.preventDefault();
    if (decision.openExternally) void shell.openExternal(decision.openExternally);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    const decision = windowOpenDecision(url);
    if (decision.openExternally) void shell.openExternal(decision.openExternally);
    return { action: 'deny' };
  });

  // An environment that does not answer leaves no page: the window asks again (DR-A). Not an aborted
  // load (-3), which is a navigation superseding it.
  window.webContents.on('did-fail-load', (_event, code, _description, failed, isMainFrame) => {
    if (!isMainFrame || code === -3 || rendererTarget?.kind !== 'url') return;
    // The address that failed, never the page still showing, which may be the screen itself.
    if (isConnectScreen(failed, connectScreen(location))) return;
    showConnect(window, true);
  });

  if (startsAtConnect(location)) showConnect(window);
  else load(window, resolveRendererTarget(location));

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
  setTrayMenu();
  tray.on('click', showWindow);

  // Windows and Linux cannot invert the glyph themselves, so follow the system theme and swap
  // the file. On macOS this recomputes to the same template image and costs nothing.
  nativeTheme.on('updated', () => tray?.setImage(currentTrayIcon()));
}

/** The tray's menu in the interface's language, again whenever it changes (UI-I). */
function setTrayMenu(): void {
  tray?.setContextMenu(
    Menu.buildFromTemplate(
      trayMenu(
        desktopWords(language),
        updates(process.platform, app.isPackaged)
          ? updateTrayItem(update, desktopWords(language))
          : null,
      ).map((item) => {
        switch (item.kind) {
          case 'separator':
            return { type: 'separator' };
          case 'show':
            return { label: item.label, click: showWindow };
          case 'connect':
            return {
              label: item.label,
              click: () => {
                showWindow();
                if (mainWindow !== null) showConnect(mainWindow);
              },
            };
          case 'update':
            return {
              label: item.label,
              enabled: item.enabled,
              click: () => stepUpdate({ kind: 'check', asked: true }),
            };
          case 'quit':
            return { label: item.label, role: 'quit' };
        }
      }),
    ),
  );
}

/** Takes an update one event on: the tray and the taskbar follow it, then what it calls for is done. */
function stepUpdate(event: UpdateEvent): void {
  const next = updateStep(update, event);
  // Drawn again only where it moved: progress arrives many times a second.
  if (next.state !== update) {
    update = next.state;
    setTrayMenu();
    mainWindow?.setProgressBar(update.kind === 'downloading' ? update.percent / 100 : -1);
  }
  if (next.act !== null) void carryOut(next.act);
}

/** A question to the person, in a native dialog over the window: the index of the button they chose. */
async function ask(message: string, detail: string, buttons: string[]): Promise<number> {
  const options = {
    type: 'info' as const,
    title: desktopWords(language)['desktop.update.title'],
    message,
    detail,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true,
  };
  const { response } =
    mainWindow === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(mainWindow, options);
  return response;
}

/** Does what an update step calls for (DR-H): ask the updater, ask the person, tell them, install. */
async function carryOut(act: UpdateAct): Promise<void> {
  const words = desktopWords(language);
  switch (act.kind) {
    case 'check':
      // A failure also arrives as the updater's `error`, which the step takes once.
      await autoUpdater.checkForUpdates().catch(() => stepUpdate({ kind: 'failed' }));
      return;
    case 'download':
      await autoUpdater.downloadUpdate().catch(() => stepUpdate({ kind: 'failed' }));
      return;
    case 'install':
      // Silent, and the app comes back: the person already chose to restart.
      autoUpdater.quitAndInstall(true, true);
      return;
    case 'offer': {
      const chosen = await ask(
        fill(words['desktop.update.available'], { version: act.version }),
        words['desktop.update.available-detail'],
        [words['desktop.update.download'], words['desktop.update.not-now']],
      );
      stepUpdate(chosen === 0 ? { kind: 'download' } : { kind: 'not-now' });
      return;
    }
    case 'offer-restart': {
      const chosen = await ask(
        fill(words['desktop.update.ready'], { version: act.version }),
        words['desktop.update.ready-detail'],
        [words['desktop.update.restart-now'], words['desktop.update.later']],
      );
      stepUpdate(chosen === 0 ? { kind: 'restart' } : { kind: 'later' });
      return;
    }
    case 'tell':
      await ask(words[act.said === 'none' ? 'desktop.update.none' : 'desktop.update.failed'], '', [
        words['desktop.update.ok'],
      ]);
      stepUpdate({ kind: 'dismissed' });
      return;
  }
}

/** How long after start the first check waits, so it does not compete with the window opening. */
const FIRST_CHECK_MS = 10_000;

/**
 * The updater (the DR plan, DR-H; ADM-053): GitHub's releases, read from the app-update.yml the
 * packaging writes, offered and never downloaded unasked, installed on a restart or the next quit.
 * Its own log is off: it names the release's address, which a crash report has no need of.
 */
function startUpdates(): void {
  if (!updates(process.platform, app.isPackaged)) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('update-available', (info) =>
    stepUpdate({ kind: 'available', version: info.version }),
  );
  autoUpdater.on('update-not-available', () => stepUpdate({ kind: 'none' }));
  autoUpdater.on('download-progress', (progress) =>
    stepUpdate({ kind: 'progress', percent: progress.percent }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    stepUpdate({ kind: 'downloaded', version: info.version }),
  );
  autoUpdater.on('error', () => {
    console.warn('An update check or download failed.');
    stepUpdate({ kind: 'failed' });
  });
  setTimeout(() => stepUpdate({ kind: 'check', asked: false }), FIRST_CHECK_MS);
}

/** Whether an IPC call comes from the renderer, and no page the window was taken to (issue #309). */
function fromRenderer(event: Electron.IpcMainInvokeEvent): boolean {
  return isTrustedFrame(event.senderFrame?.url, rendererTarget);
}

ipcMain.handle(PLATFORM_INFO_CHANNEL, (event) => {
  if (!fromRenderer(event)) throw new Error('Refused: not the renderer.');
  return { ...describePlatform(process.versions), ...(connectedTo ? { connectedTo } : {}) };
});

/** How long an address has to answer before it is unreachable (DR-C). */
const CONNECT_TIMEOUT_MS = 10_000;

// Connecting to an environment (ADM-051): asked by the Connect to screen alone, never a served page, so
// an environment cannot point the app at another (DR-C). The address is checked here, never trusted.
ipcMain.handle(CONNECT_CHANNEL, async (event, requested: unknown) => {
  if (!isConnectScreen(event.senderFrame?.url, connectScreen(rendererLocation()))) {
    throw new Error('Refused: not the Connect to screen.');
  }
  const decision = addressDecision(requested);
  if (decision.kind === 'refused') return decision;
  let answer: ReturnType<typeof environmentAnswer>;
  try {
    const response = await net.fetch(`${decision.origin}/v1/me`, {
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
    answer = environmentAnswer(response.status, await response.json().catch(() => null));
  } catch {
    return { kind: 'refused', reason: 'unreachable' } as const;
  }
  if (answer !== 'environment') return { kind: 'refused', reason: answer } as const;
  keepAddress(app.getPath('userData'), decision.origin);
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window !== null) load(window, { kind: 'url', value: decision.origin });
  return { kind: 'connected', origin: decision.origin } as const;
});

// The spelling checker's languages (CNT-178): what the renderer sent is checked in shell.ts, never
// trusted, and a refusal is logged without what was sent.
ipcMain.handle(SPELL_CHECK_LANGUAGES_CHANNEL, (event, requested: unknown) => {
  // The renderer's own frame alone, as every handler (issue #309).
  if (!fromRenderer(event)) throw new Error('Refused: not the renderer.');
  const { session } = event.sender;
  const choice = spellCheckerChoice(
    requested,
    session.availableSpellCheckerLanguages,
    process.platform,
  );
  if (choice.kind === 'refused') {
    console.warn('Refused a request for spelling languages that was not a short list of tags.');
  } else if (choice.kind === 'set') {
    session.setSpellCheckerLanguages([...choice.languages]);
  }
});

// The interface's language (UI-I): a declared tag alone, else refused and logged without what was sent.
ipcMain.handle(INTERFACE_LANGUAGE_CHANNEL, (event, requested: unknown) => {
  if (!fromRenderer(event)) throw new Error('Refused: not the renderer.');
  if (!isInterfaceLanguage(requested)) {
    console.warn('Refused an interface language that was not a declared tag.');
    return;
  }
  language = requested;
  setTrayMenu();
});

void app.whenReady().then(() => {
  language = desktopLanguage(app.getLocale());

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
  startUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // macOS keeps the app alive with no windows; every other platform expects it to exit.
  if (process.platform !== 'darwin') app.quit();
});
