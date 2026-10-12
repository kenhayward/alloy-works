import type { ContentDocument } from '@alloy-works/domain';

import { mayKeepEditing } from './editing-storage.js';
import type { SessionService } from './session.js';

/**
 * A suggestion's draft (collaboration.md, Suggestions; the SG plan, SG-J): the component editor with
 * no lock, no editing session and nothing sent to the service until **Send suggestion**. What the
 * reviewer types is kept in the tab, under the editing prefix `forgetEditing` clears at sign-out.
 */
export interface DraftMode {
  /** Sends the draft as a suggestion; true once it is made, which closes the draft. */
  readonly onSend: (content: ContentDocument, version: string) => Promise<boolean>;
  /** Leaves the draft without sending it. */
  readonly onDiscard: () => void;
  /** Whether the reviewer may add an image to the component's space (`create`). */
  readonly mayUpload: boolean;
}

/** Where a draft is kept, by whose and of which component. */
export const draftKey = (component: string, principal: string) =>
  `alloy-works:editing-draft:${principal}:${component}`;

/** A kept draft: the version it was made from, kept with it so it is sent against that version. */
export interface KeptDraft {
  readonly version: { readonly id: string; readonly number: string };
  readonly content: ContentDocument;
}

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The draft this tab kept of a component, whatever version it was made from: a newer version cut
 * meanwhile never drops it, since a suggestion applies to the component as it is then (the SG final
 * review).
 */
export function readDraft(component: string, principal: string): KeptDraft | null {
  try {
    const kept = storage()?.getItem(draftKey(component, principal));
    if (!kept) return null;
    const parsed = JSON.parse(kept) as KeptDraft;
    return typeof parsed.version?.id === 'string' && typeof parsed.version.number === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** Forgets the draft this tab kept of a component. */
export function forgetDraft(component: string, principal: string): void {
  try {
    storage()?.removeItem(draftKey(component, principal));
  } catch {
    // Storage refused: nothing was kept.
  }
}

/**
 * The session's service, for a draft: every claim granted, every save kept in the tab, and nothing
 * cut, released, listed or taken - the service is never asked, so the editor's phases run as they do
 * for an author while the component stays untouched (COL-025).
 */
export function draftService(
  component: string,
  principal: string,
  version: { readonly id: string; readonly number: string },
): SessionService {
  return {
    claim: async () => ({ ok: true }),
    save: async (_sequence, _openedFrom, content) => {
      // Nothing is written once the tab is signed out of (editing-storage.ts): a late save must not
      // bring back what the sign-out forgot.
      if (!mayKeepEditing()) return { ok: true };
      try {
        storage()?.setItem(draftKey(component, principal), JSON.stringify({ version, content }));
      } catch {
        // Storage refused: the draft holds for this page, and is not kept.
      }
      return { ok: true };
    },
    cut: async () => ({ ok: true, outcome: 'unchanged', version }),
    release: async () => ({ ok: true, outcome: 'unchanged', version }),
    iterations: async () => ({ ok: true, items: [], next: null }),
    iteration: async () => ({ ok: false, code: 'failed' }),
    take: async () => ({ ok: false, code: 'lock_free' }),
  };
}

/** A store that keeps nothing past the page: what the editor records of a draft for a reload. */
export function memoryStore(): Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
> {
  const held = new Map<string, string>();
  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    key: (index) => [...held.keys()][index] ?? null,
    get length() {
      return held.size;
    },
  };
}
