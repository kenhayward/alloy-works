import { reportMessages } from '@alloy-works/domain';

import { words, type WordKey } from '../words/words.js';

/**
 * An admission report's fixed sentence in the reader's language, by its action and subject (the UI
 * plan, UI-L): a paste's, an import's. One the catalogue does not hold is said as the report said it.
 */
export function reportWords(entry: {
  readonly action: string;
  readonly subject: string;
  readonly message: string;
}): string {
  const subjects: Readonly<Record<string, string>> | undefined =
    reportMessages[entry.action as keyof typeof reportMessages];
  return subjects !== undefined && Object.hasOwn(subjects, entry.subject)
    ? words(`admission.${entry.action}.${entry.subject}` as WordKey)
    : entry.message;
}
