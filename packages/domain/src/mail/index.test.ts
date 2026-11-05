import { describe, expect, it } from 'vitest';
import {
  mailAddressSchema,
  mailCredentialContext,
  mailDisplayNameSchema,
  mailHostSchema,
  mailPasswordSchema,
  mailPortSchema,
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
