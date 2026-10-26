/**
 * The runtime's own date formatting and time zone, captured before the bundled one replaces it
 * (the UI plan, UI-A): instant arithmetic in any IANA zone (`metadata/dateTime.ts`) needs the runtime's
 * full zone data, and the bundled formatter is told the zone the runtime is in.
 */
export const NativeDateTimeFormat = Intl.DateTimeFormat;

export const nativeTimeZone = (): string => new NativeDateTimeFormat().resolvedOptions().timeZone;
