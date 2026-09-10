import type { PlatformBridge } from './contract.js';

export type { PlatformBridge, PlatformInfo } from './contract.js';

/**
 * Injected by the desktop shell's preload script. Adding a method here means adding a matching IPC
 * handler in the main process that validates its own arguments - the renderer is untrusted, and it
 * having already checked is not a check.
 */
export interface BridgeHost {
  alloyWorks?: PlatformBridge;
}

declare global {
  interface Window {
    alloyWorks?: PlatformBridge;
  }
}

export const browserBridge: PlatformBridge = {
  getPlatformInfo: async () => ({ delivery: 'web', runtime: 'Browser' }),
};

export function resolveBridge(host: BridgeHost = window): PlatformBridge {
  return host.alloyWorks ?? browserBridge;
}
