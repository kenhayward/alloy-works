/**
 * **A notification's mail, in words** (mail.md; the EM plan, EM-E): what kind of thing happened and a
 * link to the inbox, never a title, text, actor or document name (COL-036); a digest, counts alone
 * (COL-053). In the person's interface language, else English: a pseudo-locale is English made over, as
 * the interface's is, so a word left in English shows.
 */

/** The kinds of notification mailed, the digest its own for opting out (EM-W). */
export const MAIL_KINDS = ['mention', 'reply', 'resolution', 'round', 'digest'] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

/** What a digest's mail counts: the kinds left on alone. */
export interface MailCounts {
  readonly mention: number;
  readonly reply: number;
  readonly resolution: number;
  readonly round: number;
}

interface Catalogue {
  readonly subject: Readonly<Record<MailKind, string>>;
  readonly said: Readonly<Record<MailKind, string>>;
  readonly counted: Readonly<Record<keyof MailCounts, string>>;
  readonly open: string;
  readonly why: string;
}

const ENGLISH: Catalogue = {
  subject: {
    mention: 'Somebody mentioned you in a comment',
    reply: 'A new reply on a thread you are in',
    resolution: 'A thread you are in was resolved',
    round: 'You have been asked to review a document',
    digest: 'Your daily digest',
  },
  said: {
    mention: 'Somebody mentioned you in a comment in Alloy Works.',
    reply: 'Somebody replied on a thread you are in, in Alloy Works.',
    resolution: 'A thread you are in was resolved, in Alloy Works.',
    round: 'You have been named a reviewer of a document in Alloy Works.',
    digest: 'Since the last digest, in Alloy Works:',
  },
  counted: {
    mention: 'Mentions of you: {count}',
    reply: 'Replies on threads you are in: {count}',
    resolution: 'Threads you are in resolved: {count}',
    round: 'Documents you were asked to review: {count}',
  },
  open: 'Open your inbox to see it:',
  why: 'Your environment sends notifications by email. To choose which you get, change how you are told in your inbox.',
};

const ACCENTED: Readonly<Record<string, string>> = Object.fromEntries(
  [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter, at) => [
    letter,
    [...'åƀçðéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÅƁÇÐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ'][at]!,
  ]),
);

/** English made over (LOC-042): letters accented outside a placeholder, the whole bracketed. */
function pseudo(message: string, rtl: boolean): string {
  const accented = message
    .split(/(\{[a-z]+\})/)
    .map((part) =>
      part.startsWith('{') ? part : [...part].map((each) => ACCENTED[each] ?? each).join(''),
    )
    .join('');
  const made = `[${accented}]`;
  return rtl ? `${String.fromCharCode(0x202e)}${made}${String.fromCharCode(0x202c)}` : made;
}

function catalogueOf(language: string | null): (message: string) => string {
  if (language === 'en-XA') return (message) => pseudo(message, false);
  if (language === 'ar-XB') return (message) => pseudo(message, true);
  return (message) => message;
}

/**
 * A notification's subject and text: `link` the inbox at the environment's address, `counts` a
 * digest's, of the kinds left on. Line feeds alone, as the connector asks.
 */
export function mailWords(input: {
  readonly kind: MailKind;
  readonly language: string | null;
  readonly link: string;
  readonly counts?: MailCounts;
}): { readonly subject: string; readonly text: string } {
  const say = catalogueOf(input.language);
  const lines = [say(ENGLISH.said[input.kind])];
  if (input.kind === 'digest' && input.counts !== undefined) {
    for (const kind of ['mention', 'reply', 'resolution', 'round'] as const) {
      const count = input.counts[kind];
      if (count > 0) lines.push(say(ENGLISH.counted[kind]).replace('{count}', String(count)));
    }
  }
  return {
    subject: say(ENGLISH.subject[input.kind]),
    text: [...lines, '', say(ENGLISH.open), input.link, '', say(ENGLISH.why)].join('\n'),
  };
}

/** Every English message, for the checks every word the product shows passes. */
export const MAIL_MESSAGES: readonly string[] = [
  ...Object.values(ENGLISH.subject),
  ...Object.values(ENGLISH.said),
  ...Object.values(ENGLISH.counted),
  ENGLISH.open,
  ENGLISH.why,
];
