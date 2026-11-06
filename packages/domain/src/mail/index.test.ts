import { describe, expect, it } from 'vitest';
import {
  mailAddressSchema,
  mailCredentialContext,
  mailAnswerSchema,
  mailBackoffSeconds,
  mailDisplayNameSchema,
  mailHostSchema,
  mailPasswordSchema,
  mailPortSchema,
  mailRequestSchema,
  mailUsernameSchema,
} from './index.js';

const BREAKS = [String.fromCharCode(13), String.fromCharCode(10)];

describe('a mail channel’s settings (the EM plan, EM-I and EM-J)', () => {
  it('takes a host name or address, and nothing with a scheme, a path or a space', () => {
    for (const host of ['mail.example.test', '192.0.2.10', '[2001:db8::1]']) {
      expect(mailHostSchema.safeParse(host).success, host).toBe(true);
    }
    for (const host of ['', 'smtp://mail.example.test', 'mail.example.test/x', 'a b']) {
      expect(mailHostSchema.safeParse(host).success, host).toBe(false);
    }
  });

  it('takes the two ports that are TLS, and no other', () => {
    expect(mailPortSchema.safeParse(465).success).toBe(true);
    expect(mailPortSchema.safeParse(587).success).toBe(true);
    for (const port of [25, 1025, 0]) expect(mailPortSchema.safeParse(port).success).toBe(false);
  });

  it('refuses a line break in any value', () => {
    for (const line of BREAKS) {
      const broken = `one${line}Bcc: two@example.test`;
      expect(mailHostSchema.safeParse(broken).success).toBe(false);
      expect(mailUsernameSchema.safeParse(broken).success).toBe(false);
      expect(mailDisplayNameSchema.safeParse(broken).success).toBe(false);
      expect(mailAddressSchema.safeParse(`a@example.test${broken}`).success).toBe(false);
      expect(mailPasswordSchema.safeParse(broken).success).toBe(false);
    }
  });

  it('binds a password to its host, port and username, each of them telling', () => {
    const held = mailCredentialContext('mail.example.test', 587, 'ada');
    expect(mailCredentialContext('other.example.test', 587, 'ada')).not.toBe(held);
    expect(mailCredentialContext('mail.example.test', 465, 'ada')).not.toBe(held);
    expect(mailCredentialContext('mail.example.test', 587, 'grace')).not.toBe(held);
    // No value can stand for two: the parts cannot run together.
    expect(mailCredentialContext('a', 587, 'b')).not.toBe(mailCredentialContext('a5', 87, 'b'));
  });
});

const request = (over: Record<string, unknown> = {}) => ({
  requestId: '6f1c1b1e-9a3b-4c55-8a51-0d6f3c1a2b01',
  tenant: 'acme',
  id: '6f1c1b1e-9a3b-4c55-8a51-0d6f3c1a2b02',
  relay: { kind: 'platform' },
  fromName: 'Acme',
  to: 'ada@example.test',
  subject: 'Something happened',
  text: 'Something happened.\nOpen it here.',
  ...over,
});

describe('a mail as the worker asks the connector to send it (EM-I, EM-J)', () => {
  it('takes the operator’s relay, or its own with an address and a sealed password', () => {
    expect(mailRequestSchema.safeParse(request()).success).toBe(true);
    const own = {
      kind: 'own',
      host: 'mail.example.test',
      port: 587,
      username: 'ada',
      sealed: 'sealed',
      fromAddress: 'news@example.test',
    };
    expect(mailRequestSchema.safeParse(request({ relay: own })).success).toBe(true);
    expect(
      mailRequestSchema.safeParse(request({ relay: { ...own, username: null, sealed: null } }))
        .success,
    ).toBe(true);
    // The operator's relay takes no address of the tenant's: the connector names its own (EM-K).
    expect(
      mailRequestSchema.safeParse(
        request({ relay: { kind: 'platform', fromAddress: 'ceo@example.test' } }),
      ).success,
    ).toBe(false);
  });

  it('refuses a line break in the recipient, subject or name, and any control in the text but a line feed', () => {
    for (const line of BREAKS) {
      expect(mailRequestSchema.safeParse(request({ to: `ada@example.test${line}` })).success).toBe(
        false,
      );
      expect(mailRequestSchema.safeParse(request({ subject: `one${line}Bcc: x` })).success).toBe(
        false,
      );
      expect(mailRequestSchema.safeParse(request({ fromName: `one${line}two` })).success).toBe(
        false,
      );
    }
    expect(
      mailRequestSchema.safeParse(request({ text: `one${String.fromCharCode(13)}two` })).success,
    ).toBe(false);
    expect(
      mailRequestSchema.safeParse(request({ text: `one${String.fromCharCode(0)}two` })).success,
    ).toBe(false);
  });

  it('answers sent, or failed with a code and at most the SMTP code, never the reply’s words', () => {
    expect(mailAnswerSchema.safeParse({ type: 'sent', latencyMs: 4 }).success).toBe(true);
    expect(
      mailAnswerSchema.safeParse({
        type: 'failed',
        code: 'recipient_refused',
        smtpCode: 550,
        latencyMs: 4,
      }).success,
    ).toBe(true);
    expect(
      mailAnswerSchema.safeParse({
        type: 'failed',
        code: 'recipient_refused',
        smtpCode: 550,
        reply: '550 no such user ada@example.test',
        latencyMs: 4,
      }).success,
    ).toBe(false);
  });

  it('waits from 30 seconds, doubling to an hour', () => {
    expect([0, 1, 2, 7, 8, 20].map(mailBackoffSeconds)).toEqual([30, 60, 120, 3600, 3600, 3600]);
  });
});
