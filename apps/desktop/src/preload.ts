import { contextBridge, ipcRenderer } from 'electron';

import { BRIDGE_GLOBAL, PLATFORM_INFO_CHANNEL } from './shell.js';

// One property, one method, one channel. Anything added here needs a matching main-process handler
// that validates its own arguments - never a general "run this for me" bridge.
contextBridge.exposeInMainWorld(BRIDGE_GLOBAL, {
  getPlatformInfo: () => ipcRenderer.invoke(PLATFORM_INFO_CHANNEL),
});
