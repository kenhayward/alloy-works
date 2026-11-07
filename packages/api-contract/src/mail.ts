import {
  MAIL_KINDS,
  mailAddressSchema,
  mailDisplayNameSchema,
  mailHostSchema,
  mailPasswordSchema,
  mailPortSchema,
  mailRelaySchema,
  mailUsernameSchema,
} from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { nextCursor, pageQuery } from './listing.js';
import { ErrorBody } from './schemas.js';

/** The kinds of notification mailed, the digest its own (EM-W). */
export const MailKind = z.enum(MAIL_KINDS);

/** A tenant's mail channel (mail.md; the EM plan), never its password. */
export const MailChannelView = z.strictObject({
  enabled: z.boolean().describe('Whether this environment sends mail at all'),
  relay: mailRelaySchema.describe('The operator’s relay, or one this environment names'),
  host: z.string().nullable().describe('Its own relay’s host'),
  port: z.number().int().nullable().describe('Its own relay’s port: 465 or 587'),
  username: z.string().nullable().describe('Its own relay’s username, null for none'),
  fromAddress: z.string().nullable().describe('The address its own relay sends from'),
  fromName: z.string().nullable().describe('The name shown as the sender'),
  hasPassword: z.boolean().describe('Whether a password is held; it is never answered'),
  failingSince: z
    .string()
    .nullable()
    .describe('Since when its relay has failed, cleared by the next mail it sends'),
  lastSuccessAt: z.string().nullable().describe('When its relay last took a mail'),
  kindsOff: z
    .array(MailKind)
    .describe('The kinds of notification this environment never mails, whatever a person chooses'),
});
export type MailChannelView = z.infer<typeof MailChannelView>;

export const MailChannelRead = z.strictObject({
  channel: MailChannelView,
  platform: z.strictObject({
    offered: z.boolean().describe('Whether the operator offers a relay here'),
    fromAddress: z.string().optional().describe('The address the operator’s relay sends from'),
  }),
});
export type MailChannelRead = z.infer<typeof MailChannelRead>;

export const SetMailChannelBody = z
  .strictObject({
    enabled: z.boolean().describe('Whether this environment sends mail at all'),
    relay: mailRelaySchema.describe('The operator’s relay, or one this environment names'),
    host: mailHostSchema.optional().describe('Its own relay’s host'),
    port: mailPortSchema.optional().describe('Its own relay’s port: 465 or 587'),
    username: mailUsernameSchema.nullable().optional().describe('Its own relay’s, if it asks'),
    fromAddress: mailAddressSchema.optional().describe('The address its own relay sends from'),
    fromName: mailDisplayNameSchema.nullable().optional().describe('The name shown as the sender'),
    kindsOff: z
      .array(MailKind)
      .max(MAIL_KINDS.length)
      .optional()
      .describe('The kinds never mailed; those held are kept where none are named'),
  })
  .refine(
    ({ relay, host, port, username, fromAddress }) =>
      relay === 'own'
        ? host !== undefined && port !== undefined && fromAddress !== undefined
        : host === undefined &&
          port === undefined &&
          username === undefined &&
          fromAddress === undefined,
    'its own relay names a host, port and address, and the operator’s none of them',
  );
export type SetMailChannelBody = z.infer<typeof SetMailChannelBody>;

export const MailTestQueued = z.strictObject({
  id: z.uuid().describe('The test’s own id, which it is sent with as its Message-ID'),
});
export type MailTestQueued = z.infer<typeof MailTestQueued>;

export const MailListQuery = z.object(pageQuery);
export type MailListQuery = z.infer<typeof MailListQuery>;

export const MailSummary = z.strictObject({
  id: z.uuid().describe('Its own id, which it is sent with as its Message-ID'),
  purpose: z
    .enum(['test', 'notification', 'invitation', 'closure'])
    .describe('Why it is sent: a test, a notification, an invitation, or a notice of closing'),
  state: z
    .enum(['pending', 'sent', 'given_up', 'dropped'])
    .describe(
      '`pending`: to be tried, at `nextAt`; `sent`: the relay took it; `given_up`: refused for good, or tried too long; `dropped`: never sent, for `droppedReason`',
    ),
  droppedReason: z
    .string()
    .nullable()
    .describe(
      'Why it was never sent: `unverified`, `no_address`, `disabled`, `erased`, `service_identity`, `relay_not_configured`; for a notification, `channel_off`, `read` within its hold, `environment_off`, `opted_out`, `no_longer_told` or `no_hostname`; for an invitation, `accepted`, `expired`, `no_hostname`, `invitation_repeated` within a day of the last to its address, or `invitation_quota` past 100 in a day; for a notice of closing, `closure_cancelled`',
    ),
  attempts: z.number().int(),
  createdAt: z.string(),
  nextAt: z.string().nullable(),
  last: z
    .strictObject({
      at: z.string(),
      failure: z
        .string()
        .nullable()
        .describe('Why it was not sent, by code: `auth_failed`, `tls_failed` and the like'),
      smtpCode: z.number().int().nullable().describe('What the relay answered, by its code alone'),
    })
    .nullable()
    .describe('Its last attempt, never the relay’s words, which can quote an address'),
});
export type MailSummary = z.infer<typeof MailSummary>;

export const MailList = z.strictObject({
  items: z.array(MailSummary),
  next: nextCursor,
  counts: z
    .strictObject({
      waiting: z.number().int(),
      sent: z.number().int(),
      givenUp: z.number().int(),
      dropped: z.record(z.string(), z.number().int()).describe('By reason'),
    })
    .describe('These 30 days'),
});
export type MailList = z.infer<typeof MailList>;

export const SetMailPasswordBody = z.strictObject({
  password: mailPasswordSchema.describe('The relay’s password, write-only'),
});
export type SetMailPasswordBody = z.infer<typeof SetMailPasswordBody>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const forbidden = {
  description:
    'forbidden: the caller does not hold the permission this needs at the environment; or token_not_allowed: a session is required',
  schema: ErrorBody,
} as const;
const CONFIGURE = {
  check: 'permission',
  permission: 'configure_services',
  target: { tenant: true },
  credential: 'session',
} as const;

export const mailChannelRoutes = {
  getMailChannel: {
    operationId: 'getMailChannel',
    method: 'GET',
    path: '/v1/mail-channel',
    summary: 'How this environment’s mail leaves, never its password',
    tenantScoped: true,
    reads: 'metadata',
    access: CONFIGURE,
    responses: {
      200: { description: 'The channel, and what the operator offers', schema: MailChannelRead },
      401: unauthenticated,
      403: forbidden,
    },
  },
  setMailChannel: {
    operationId: 'setMailChannel',
    method: 'PUT',
    path: '/v1/mail-channel',
    summary: 'Turn this environment’s mail on or off, and choose its relay',
    tenantScoped: true,
    reads: 'metadata',
    access: CONFIGURE,
    body: SetMailChannelBody,
    idempotencyKey: false,
    responses: {
      200: { description: 'The channel as it now stands', schema: MailChannelRead },
      400: { description: 'A setting that is not valid', schema: ErrorBody },
      401: unauthenticated,
      403: forbidden,
      409: {
        description:
          'mail_relay_unavailable: the operator offers no relay here; or mail_no_password: its own relay needs a password set for this host, port and username',
        schema: ErrorBody,
      },
    },
  },
  setMailPassword: {
    operationId: 'setMailPassword',
    method: 'PUT',
    path: '/v1/mail-channel/password',
    summary: 'Set the password of this environment’s own relay, sealed to that relay',
    tenantScoped: true,
    reads: 'none',
    access: { ...CONFIGURE, permission: 'rotate_secrets' },
    body: SetMailPasswordBody,
    idempotencyKey: false,
    responses: {
      200: { description: 'Kept sealed; the channel as it now stands', schema: MailChannelRead },
      400: { description: 'A password that is not valid', schema: ErrorBody },
      401: unauthenticated,
      403: forbidden,
      409: {
        description:
          'mail_no_password_needed: there is no relay of its own with a username to hold a password for',
        schema: ErrorBody,
      },
      503: { description: 'connector_unavailable: it cannot be sealed now', schema: ErrorBody },
    },
  },
  testMailChannel: {
    operationId: 'testMailChannel',
    method: 'POST',
    path: '/v1/mail-channel/test',
    summary: 'Send a test of this environment’s mail to your own address',
    tenantScoped: true,
    reads: 'metadata',
    access: CONFIGURE,
    idempotencyKey: false,
    responses: {
      // 200, not 202: a permission-checked handler cannot set a status.
      200: { description: 'Queued; it is sent within a minute', schema: MailTestQueued },
      401: unauthenticated,
      403: forbidden,
      409: {
        description:
          'mail_no_verified_address: your own address is not one your provider has verified',
        schema: ErrorBody,
      },
    },
  },
  listMail: {
    operationId: 'listMail',
    method: 'GET',
    path: '/v1/mail-channel/mail',
    summary: 'This environment’s mail, newest first, kept 30 days',
    tenantScoped: true,
    reads: 'content',
    access: CONFIGURE,
    query: MailListQuery,
    responses: {
      200: { description: 'A page of its mail, and what waits', schema: MailList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
    },
  },
} as const satisfies Record<string, RouteContract>;
