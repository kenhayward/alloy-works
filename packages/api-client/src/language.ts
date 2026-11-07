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

/** Why a support person reads content (ADM-026), once they have said they will; none until told. */
let supportRead: string | undefined;

/**
 * Says, on every request every client makes from now on, `Support-Read: <purpose>`: a support person's
 * deliberate act of reading content (support.md). Said in ASCII, which every header carries. `undefined` stops.
 */
export function sendSupportRead(purpose: string | undefined): void {
  supportRead = purpose === undefined ? undefined : headerSafe(purpose);
}

/** The purpose to say now, or undefined. */
export const saidSupportRead = (): string | undefined => supportRead;

/** Printable ASCII alone: curly quotes and dashes as their plain forms, the rest dropped, spaces folded. */
function headerSafe(text: string): string | undefined {
  let plain = '';
  for (const each of text.normalize('NFKC')) {
    const code = each.codePointAt(0)!;
    if (code === 0x2018 || code === 0x2019 || code === 0x02bc) plain += "'";
    else if (code === 0x201c || code === 0x201d) plain += '"';
    else if ((code >= 0x2010 && code <= 0x2015) || code === 0x2212) plain += '-';
    else if (code >= 0x20 && code <= 0x7e) plain += each;
    else plain += ' ';
  }
  plain = plain.replace(/\s+/gu, ' ').trim();
  return plain === '' ? undefined : plain;
}
