import { reportMessages } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { reportWords } from './reportWords.js';

describe("the admission report's sentences in the reader's language (the UI plan, UI-L)", () => {
  it('words each fixed sentence by its action and subject, as the domain says it in English', () => {
    for (const [action, subjects] of Object.entries(reportMessages)) {
      for (const [subject, message] of Object.entries(subjects)) {
        expect(reportWords({ action, subject, message: 'In English' })).toBe(message);
      }
    }
  });

  it('says what it has no words for as the report said it', () => {
    expect(reportWords({ action: 'discarded', subject: 'later', message: 'In English' })).toBe(
      'In English',
    );
  });
});
