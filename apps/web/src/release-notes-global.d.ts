import type { ReleaseNotes } from './release-notes.js';

declare global {
  /** The changelog's newest entry, read by vite.config.ts at build and test time; null where it has none. */
  const __RELEASE_NOTES__: ReleaseNotes | null;
}
