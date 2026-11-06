import { describe, expect, it } from 'vitest';
import {
  CLOSURE_NOTICES,
  closureWords,
  invitationWords,
  MAIL_KINDS,
  MAIL_MESSAGES,
  mailWords,
} from './words.js';

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

describe('an invitation’s and a closing’s mail in words (the EM plan, EM-U and EM-V)', () => {
  const SIGN_IN = 'https://acme.alloy.test/';
  const ENDS = new Date('2026-12-06T09:00:00Z');

  it('IAM-089 invites with a link to sign in and no token, naming nobody', () => {
    const { subject, text } = invitationWords({ language: 'en-GB', link: SIGN_IN });
    expect(subject).toBe('You have been invited to Alloy Works');
    expect(text).toContain(`\n${SIGN_IN}\n`);
    expect(text).toMatch(/this address/);
    expect(text).not.toMatch(/[\r?=]/);
  });

  it('ADM-055 says what is happening to the environment and by when, with no link', () => {
    for (const notice of CLOSURE_NOTICES) {
      const { subject, text } = closureWords({
        notice,
        language: null,
        graceEndsAt: notice === 'cancelled' ? null : ENDS,
      });
      expect(subject, notice).not.toMatch(/[\r\n]/);
      expect(text, notice).not.toMatch(/https?:/);
      if (notice !== 'cancelled') expect(text, notice).toContain('6 December 2026');
    }
    expect(closureWords({ notice: 'cancelled', language: null, graceEndsAt: null }).text).toMatch(
      /no longer closing/,
    );
    for (const message of MAIL_MESSAGES) expect(message).not.toMatch(/[–—]/);
  });

  it('makes an invitation and a notice over in a pseudo-locale, but the date and the link', () => {
    const invited = invitationWords({ language: 'en-XA', link: SIGN_IN });
    expect(invited.text).toContain(`\n${SIGN_IN}\n`);
    expect(invited.text.replace(SIGN_IN, '')).not.toMatch(/\b(invited|address)\b/);
    const told = closureWords({ notice: 'seven_days', language: 'ar-XB', graceEndsAt: ENDS });
    expect(told.text).toContain('6 December 2026');
    expect(told.subject.startsWith(String.fromCharCode(0x202e))).toBe(true);
  });
});
