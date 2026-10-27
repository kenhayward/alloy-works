import type { PlatformBridge } from '@alloy-works/web/platform' with {
  'resolution-mode': 'import',
};
import { contextBridge, ipcRenderer } from 'electron';

import {
  BRIDGE_GLOBAL,
  INTERFACE_LANGUAGE_CHANNEL,
  PLATFORM_INFO_CHANNEL,
  SPELL_CHECK_LANGUAGES_CHANNEL,
} from './shell.js';

// Three methods, three channels, and one fact. Anything added here needs a matching main-process handler that
// validates its own arguments - never a general "run this for me" bridge. Typed as the renderer's own
// contract, so a method the contract gains and the shell does not answer fails the build.
const bridge: PlatformBridge = {
  getPlatformInfo: () => ipcRenderer.invoke(PLATFORM_INFO_CHANNEL),
  // A new window opens in the system browser, which has no session (`windowOpenDecision`).
  opensServedPages: false,
  // A copy of the list, never the renderer's own object: only plain data crosses.
  setSpellCheckLanguages: async (languages) => {
    await ipcRenderer.invoke(SPELL_CHECK_LANGUAGES_CHANNEL, [...languages]);
  },
  setInterfaceLanguage: async (language) => {
    await ipcRenderer.invoke(INTERFACE_LANGUAGE_CHANNEL, language);
  },
};

contextBridge.exposeInMainWorld(BRIDGE_GLOBAL, bridge);
