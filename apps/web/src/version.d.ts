/** The canonical version, from /version.json, defined by Vite (vite.config.ts) at build and test time. */
declare const __APP_VERSION__: string;

/** The changelog's newest entry, read by vite.config.ts at build and test time; null where it has none. */
declare const __RELEASE_NOTES__: import('./release-notes.js').ReleaseNotes | null;
