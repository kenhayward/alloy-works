import {
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
import { ErrorBody } from './schemas.js';

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
} as const satisfies Record<string, RouteContract>;
