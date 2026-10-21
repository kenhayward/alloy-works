import { describe, expect, it } from 'vitest';
import { webhookSecretContext, webhookSecretSchema, webhookUrlSchema } from './index.js';

describe('a webhook subscription’s URL and secret (the WB plan, WB-G and WB-H)', () => {
  it('takes an https URL with a host and no credentials, and nothing else', () => {
    expect(webhookUrlSchema.safeParse('https://receiver.example.test/hooks').success).toBe(true);
    for (const refused of [
      'http://receiver.example.test',
      'https://ada:secret@receiver.example.test',
      'ftp://receiver.example.test',
      'not a url',
      `https://receiver.example.test/${'x'.repeat(2000)}`,
    ]) {
      expect(webhookUrlSchema.safeParse(refused).success, refused).toBe(false);
    }
  });

  it('holds a secret to the Standard Webhooks shape, and seals it to its subscription and URL', () => {
    expect(
      webhookSecretSchema.safeParse(`whsec_${Buffer.alloc(32, 1).toString('base64')}`).success,
    ).toBe(true);
    expect(webhookSecretSchema.safeParse('whsec_short').success).toBe(false);
    expect(webhookSecretContext('a', 'https://one.example.test')).not.toBe(
      webhookSecretContext('a', 'https://two.example.test'),
    );
  });
});
