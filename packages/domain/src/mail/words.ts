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

/** The notices of a closing (EM-V): on its starting, 7 days before its grace ends, on its cancelling. */
export const CLOSURE_NOTICES = ['closing', 'seven_days', 'cancelled'] as const;
export type ClosureNotice = (typeof CLOSURE_NOTICES)[number];

const INVITED = {
  subject: 'You have been invited to Alloy Works',
  said: 'You have been invited to an environment in Alloy Works.',
  open: 'To accept, sign in with this address here:',
  why: 'You were sent this because somebody invited this address. If you did not expect it, you can ignore it.',
};

const CLOSING: Readonly<
  Record<ClosureNotice, { readonly subject: string; readonly said: string }>
> = {
  closing: {
    subject: 'An environment you use is closing',
    said: 'An environment you use in Alloy Works is closing. Unless the closing is cancelled, it and everything in it will be deleted after {date}.',
  },
  seven_days: {
    subject: 'An environment you use is deleted within a week',
    said: 'An environment you use in Alloy Works is still closing. Unless the closing is cancelled, it and everything in it will be deleted after {date}.',
  },
  cancelled: {
    subject: 'An environment you use is no longer closing',
    said: 'An environment you use in Alloy Works is no longer closing. Nothing in it will be deleted.',
  },
};
const CLOSING_WHY =
  'You were sent this because you can sign in to it. Its administrators can tell you more.';

/** A day as a person reads it, in UTC, the time of day left out. */
function dayOf(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(at);
}

/**
 * An invitation's subject and text (IAM-089): `link` the environment's sign-in, and no token, since
 * claiming is by signing in with the invited address. Nobody who invited is named.
 */
export function invitationWords(input: {
  readonly language: string | null;
  readonly link: string;
}): { readonly subject: string; readonly text: string } {
  const say = catalogueOf(input.language);
  return {
    subject: say(INVITED.subject),
    text: [say(INVITED.said), '', say(INVITED.open), input.link, '', say(INVITED.why)].join('\n'),
  };
}

/**
 * A closing's notice (ADM-055): what is happening and by when, and nothing of the environment's: no
 * link, since a person may no longer be let in to it.
 */
export function closureWords(input: {
  readonly notice: ClosureNotice;
  readonly language: string | null;
  readonly graceEndsAt: Date | null;
}): { readonly subject: string; readonly text: string } {
  const say = catalogueOf(input.language);
  const words = CLOSING[input.notice];
  const said = say(words.said).replace(
    '{date}',
    input.graceEndsAt === null ? '' : dayOf(input.graceEndsAt),
  );
  return { subject: say(words.subject), text: [said, '', say(CLOSING_WHY)].join('\n') };
}

/** Every English message, for the checks every word the product shows passes. */
export const MAIL_MESSAGES: readonly string[] = [
  ...Object.values(ENGLISH.subject),
  ...Object.values(ENGLISH.said),
  ...Object.values(ENGLISH.counted),
  ENGLISH.open,
  ENGLISH.why,
  ...Object.values(INVITED),
  ...Object.values(CLOSING).flatMap((each) => [each.subject, each.said]),
  CLOSING_WHY,
];
