import { z } from 'zod';

/**
 * A mail channel's settings (mail.md; the EM plan). Each refuses a line break before anything reaches
 * a library: a break in a recipient changed who it went to in the spike (EM-J).
 */
const noControl = (value: string) => !/\p{Cc}/u.test(value);

/** A host name or address, with no scheme, path or port. */
export const mailHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.:[\]-]+$/);

/** The two ports that are TLS: 465 at once, 587 by STARTTLS, required (EM-J). */
export const mailPortSchema = z.union([z.literal(465), z.literal(587)]);

export const mailAddressSchema = z.email().max(254);

export const mailDisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(noControl, 'must hold no control characters');

export const mailUsernameSchema = z
  .string()
  .min(1)
  .max(254)
  .refine(noControl, 'must hold no control characters');

export const mailPasswordSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(noControl, 'must hold no control characters');

/** Whose relay a tenant's mail leaves by (EM-B). */
export const mailRelaySchema = z.enum(['platform', 'own']);
export type MailRelay = z.infer<typeof mailRelaySchema>;

/**
 * What a password is sealed to: its host, port and username, so it opens for no other relay, and an
 * administrator cannot repoint the host at their own server and read it through AUTH (EM-I).
 */
export function mailCredentialContext(host: string, port: number, username: string): string {
  return JSON.stringify([host, port, username]);
}

export const mailSealRequestSchema = z.strictObject({
  tenant: z.string().min(1),
  host: mailHostSchema,
  port: mailPortSchema,
  username: mailUsernameSchema,
  password: mailPasswordSchema,
});
export type MailSealRequest = z.infer<typeof mailSealRequestSchema>;

/** The most a mail's subject and text may be: words of the product's, never content (EM-E). */
export const MAIL_SUBJECT_MOST = 200;
export const MAIL_TEXT_MOST = 8 * 1024;

/** How long a send may take, connecting, TLS, AUTH and the message (EM-I). */
export const MAIL_DEADLINE_MS = 30_000;

/** How long to wait before the next attempt, from 30 seconds doubling to an hour (EM-M). */
export function mailBackoffSeconds(attempts: number): number {
  return Math.min(60 * 60, 30 * 2 ** Math.min(attempts, 7));
}

const subjectSchema = z
  .string()
  .min(1)
  .max(MAIL_SUBJECT_MOST)
  .refine(noControl, 'must hold no control characters');

/** Plain text: line feeds, and no other control character. */
const textSchema = z
  .string()
  .min(1)
  .max(MAIL_TEXT_MOST)
  .refine((value) => noControl(value.replaceAll('\n', '')), 'must hold no control but a line feed');

const sealedSchema = z.string().min(1).max(4096);

/**
 * A mail, as the worker asks the connector to send it (EM-I). The operator's relay names nothing: its
 * host, password and address are the connector's alone (EM-K). A tenant's own names its relay and
 * the password sealed to it, which only the connector opens.
 */
export const mailRequestSchema = z.strictObject({
  requestId: z.uuid(),
  tenant: z.string().min(1),
  /** The delivery's own id: its `Message-ID` and `X-Alloy-Event-Id`, kept across retries (EM-L). */
  id: z.uuid(),
  relay: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('platform') }),
    z.strictObject({
      kind: z.literal('own'),
      host: mailHostSchema,
      port: mailPortSchema,
      username: mailUsernameSchema.nullable(),
      sealed: sealedSchema.nullable(),
      fromAddress: mailAddressSchema,
    }),
  ]),
  fromName: mailDisplayNameSchema,
  to: mailAddressSchema,
  subject: subjectSchema,
  text: textSchema,
});
export type MailRequest = z.infer<typeof mailRequestSchema>;

/** Why a mail was not sent: a code, and never the relay's own words, which can quote an address (EM-N). */
export const mailFailureCodes = [
  /** The operator offers no relay, or the request named it and it has none (EM-R). */
  'relay_not_configured',
  /** The tenant's hour on the operator's relay is spent: it waits, costing no attempt (EM-S). */
  'quota_reached',
  'host_refused',
  'connection_failed',
  'tls_failed',
  'auth_failed',
  /** The relay refused the sender or the message. */
  'relay_refused',
  /** The relay refused this recipient for good: the one mail is given up, not the channel. */
  'recipient_refused',
  'timeout',
  'secret_refused',
  'connector_error',
] as const;
export type MailFailureCode = (typeof mailFailureCodes)[number];

export const mailAnswerSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('sent'), latencyMs: z.number().int().min(0) }),
  z.strictObject({
    type: z.literal('failed'),
    code: z.enum(mailFailureCodes),
    smtpCode: z.number().int().min(200).max(599).optional(),
    latencyMs: z.number().int().min(0),
  }),
]);
export type MailAnswer = z.infer<typeof mailAnswerSchema>;

/** The line the supervisor writes to a mail's child: the relay resolved, its password opened. */
export const childMailRequestSchema = z.strictObject({
  kind: z.literal('mail'),
  relay: z.strictObject({
    host: mailHostSchema,
    /** 465 or 587 as the channel names it, or a test's own relay's port. */
    port: z.number().int().min(1).max(65535),
    /** TLS from the start, as 465 is; else STARTTLS, required (EM-J). */
    implicitTls: z.boolean(),
    username: mailUsernameSchema.nullable(),
    password: mailPasswordSchema.nullable(),
    fromAddress: mailAddressSchema,
  }),
  message: mailRequestSchema.pick({
    id: true,
    fromName: true,
    to: true,
    subject: true,
    text: true,
  }),
  deny: z.array(z.string()),
  connectTimeoutMs: z.number().int().min(1).max(60_000),
  ca: z
    .string()
    .max(256 * 1024)
    .optional(),
});
export type ChildMailRequest = z.infer<typeof childMailRequestSchema>;

/**
 * A test of the channel's words (EM-P): what it is, and nothing of anybody's content. Plain, with no
 * dashes, as every word the product shows.
 */
export const TEST_MAIL = Object.freeze({
  subject: 'A test of your environment’s mail',
  text: [
    'This is a test from Alloy Works.',
    '',
    'An administrator of your environment sent it to check that its mail reaches you. It did.',
    'Nobody needs to reply.',
  ].join('\n'),
});
