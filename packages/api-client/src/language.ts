/** The language the interface is in, as the renderer says it (the UI plan, UI-H); none until told. */
let language: (() => string | undefined) | undefined;

/**
 * Says, on every request every client makes from now on, the language the interface is in, as
 * `Accept-Language`, so what the service sorts it sorts in that language (LOC-003). `undefined` stops.
 */
export function sendLanguage(current: (() => string | undefined) | undefined): void {
  language = current;
}

/** The language to say now, or undefined. */
export const saidLanguage = (): string | undefined => language?.();
