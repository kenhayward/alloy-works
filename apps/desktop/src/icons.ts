import { join } from 'node:path';

/**
 * Where the shell's files live, kept pure so it can be tested without booting Electron. main.ts
 * hands these paths to Electron and does nothing else with them.
 *
 * Main-process only. Unlike shell.ts this is never imported by the preload, which is why it may
 * use `node:path` - a sandboxed preload could not require it.
 */

/**
 * Windows groups taskbar buttons, jump lists, pinned shortcuts and toast notifications by this
 * id, not by the window or the executable. Left unset, the app inherits Electron's own identity
 * and shows Electron's icon no matter what the window and installer icons say - which is why a
 * correctly iconed app can still look like Electron in the taskbar.
 *
 * It must match `appId` in electron-builder.yml, or the installed app and the running app are
 * two different identities to Windows.
 */
export const APP_USER_MODEL_ID = 'works.alloy.desktop';

/**
 * Where image files actually live, which is not always where `app.getAppPath()` points.
 *
 * Electron loads tray and window images through its **native** image loader, and that loader is
 * not asar-aware - Node's `fs` is, which is what makes this so easy to miss. A path inside
 * `app.asar` reads fine from JavaScript and silently produces no icon when handed to `new Tray()`.
 * So the assets are unpacked at build time (`asarUnpack` in electron-builder.yml) and read from
 * the sibling `app.asar.unpacked` directory.
 *
 * Unpackaged there is no archive and the path is returned unchanged.
 */
export function assetRoot(appPath: string): string {
  return appPath.endsWith('.asar') ? `${appPath}.unpacked` : appPath;
}

export type TrayVariant = 'template' | 'black' | 'white';

/**
 * macOS asks for a template image and inverts it for the menu bar itself. Windows and Linux have
 * no such concept, so the glyph has to be swapped by hand against the chrome behind it - a dark
 * glyph on a dark taskbar is an empty space where the icon should be.
 */
export function resolveTrayVariant(platform: NodeJS.Platform, darkChrome: boolean): TrayVariant {
  if (platform === 'darwin') return 'template';
  return darkChrome ? 'white' : 'black';
}

/**
 * The 1x path. Electron resolves the `@2x` sibling on its own, so naming the 1x file is
 * deliberate - pointing at the @2x file directly gives a tray icon drawn at double size.
 */
export function trayIconPath(appPath: string, variant: TrayVariant): string {
  const file = variant === 'template' ? 'trayTemplate.png' : `tray-${variant}.png`;
  return join(assetRoot(appPath), 'assets', 'tray', file);
}

/**
 * The window and, on macOS in development, the Dock. Unrelated to the packaged application icon,
 * which comes from the bundle rather than from the running process.
 */
export function windowIconPath(appPath: string): string {
  return join(assetRoot(appPath), 'assets', 'icon.png');
}

/**
 * Where the renderer's index.html is, which differs between the two layouts:
 *
 * - **unpackaged** the workspaces sit side by side, so it is `apps/web/dist`
 * - **packaged** electron-builder copies that build into the app as `renderer/`, because
 *   `apps/web` does not exist inside the bundle
 *
 * Only the packaged branch is ever loaded from disk; unpackaged the shell uses the dev server.
 */
export function rendererIndexHtml(appPath: string, packaged: boolean): string {
  return packaged
    ? join(appPath, 'renderer', 'index.html')
    : join(appPath, '..', 'web', 'dist', 'index.html');
}
