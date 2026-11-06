import { describe, expect, it } from 'vitest';
import { MAIL_KINDS, MAIL_MESSAGES, mailWords } from './words.js';

const LINK = 'https://acme.alloy.test/#/inbox';

describe('a notification’s mail in words (the EM plan, EM-E)', () => {
  it('says each kind with the inbox’s link, in lines and no dashes', () => {
    for (const kind of MAIL_KINDS) {
      const { subject, text } = mailWords({ kind, language: 'en-GB', link: LINK });
      expect(subject, kind).not.toMatch(/[\r\n]/);
      expect(text, kind).toContain(`\n${LINK}\n`);
      expect(text, kind).not.toMatch(/\r/);
    }
    for (const message of MAIL_MESSAGES) expect(message).not.toMatch(/[–—]/);
  });

  it('counts a digest’s kinds left on alone, and none at nought', () => {
    const { text } = mailWords({
      kind: 'digest',
      language: null,
      link: LINK,
      counts: { mention: 2, reply: 0, resolution: 1, round: 0 },
    });
    expect(text).toContain('Mentions of you: 2');
    expect(text).toContain('Threads you are in resolved: 1');
    expect(text).not.toMatch(/Replies|review/);
  });

  it('makes English over in a pseudo-locale, every word but the link and the counts', () => {
    for (const language of ['en-XA', 'ar-XB']) {
      const { subject, text } = mailWords({
        kind: 'digest',
        language,
        link: LINK,
        counts: { mention: 3, reply: 0, resolution: 0, round: 0 },
      });
      expect(subject, language).toContain('[Ýöûŕ ðåîļý ðîĝéšţ]');
      expect(text, language).toContain(`\n${LINK}\n`);
      expect(text, language).toContain(': 3]');
      expect(text.replace(LINK, ''), language).not.toMatch(/\b(Your|inbox|Mentions)\b/);
    }
  });
});
