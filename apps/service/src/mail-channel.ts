import type {
  MailChannelRead,
  MailList,
  MailListQuery,
  MailTestQueued,
  SetMailChannelBody,
  SetMailPasswordBody,
} from '@alloy-works/api-contract';
import {
  listMail,
  mailableAddress,
  mailChannel,
  mailCounts,
  NO_MAIL_CHANNEL,
  queueTestMail,
  setMailChannel,
  setMailPassword,
  type MailChannel,
  type Tenant,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import type { Authorised } from './access.js';
import { afterCursor, cursorAfter, pageLimit } from './components.js';
import { createConnectorClient } from './data/connector.js';
import type { ConnectorOptions } from './data/connections.js';
import { AppError } from './errors.js';

/** What the operator's relay is, where one is offered (EM-B): the connector holds its password. */
export interface MailPlatform {
  readonly fromAddress: string;
}

/**
 * A tenant's mail channel (mail.md; the EM plan), each run in the transaction its permission was
 * decided in. A password goes to the connector, is sealed to the relay, and is never answered.
 */
export function mailChannelHandlers(
  tenantOf: (request: FastifyRequest) => Tenant,
  connector?: ConnectorOptions,
  platform?: MailPlatform,
) {
  const client = connector ? createConnectorClient(connector) : undefined;

  const read = (channel: Omit<MailChannel, 'id'> | undefined): MailChannelRead => {
    const {
      hasPassword,
      enabled,
      relay,
      host,
      port,
      username,
      fromAddress,
      fromName,
      failingSince,
      lastSuccessAt,
    } = channel ?? NO_MAIL_CHANNEL;
    return {
      channel: {
        enabled,
        relay,
        host,
        port,
        username,
        fromAddress,
        fromName,
        hasPassword,
        failingSince: failingSince && failingSince.toISOString(),
        lastSuccessAt: lastSuccessAt && lastSuccessAt.toISOString(),
      },
      platform: platform
        ? { offered: true, fromAddress: platform.fromAddress }
        : { offered: false },
    };
  };

  return {
    getMailChannel: async (_request: FastifyRequest, { trx }: Authorised) =>
      read(await mailChannel(trx)),

    setMailChannel: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const body = request.body as SetMailChannelBody;
      if (body.enabled && body.relay === 'platform' && !platform) {
        throw new AppError(
          409,
          'mail_relay_unavailable',
          'The operator offers no relay here: name your own.',
        );
      }
      const own = body.relay === 'own' ? body : undefined;
      const username = own?.username ?? null;
      const held = await mailChannel(trx, { lock: true });
      if (body.enabled && own && username !== null) {
        const same =
          held?.host === own.host && held?.port === own.port && held?.username === username;
        if (!same || !held?.hasPassword) {
          throw new AppError(
            409,
            'mail_no_password',
            'Set the password for this host, port and username before turning it on.',
          );
        }
      }
      return read(
        await setMailChannel(trx, {
          enabled: body.enabled,
          relay: body.relay,
          host: own?.host ?? null,
          port: own?.port ?? null,
          username,
          fromAddress: own?.fromAddress ?? null,
          fromName: body.fromName ?? null,
          by: principalId,
        }),
      );
    },

    setMailPassword: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { password } = request.body as SetMailPasswordBody;
      const held = await mailChannel(trx, { lock: true });
      if (held?.relay !== 'own' || !held.host || !held.port || !held.username) {
        throw new AppError(
          409,
          'mail_no_password_needed',
          'There is no relay of its own with a username to hold a password for.',
        );
      }
      if (!client) {
        throw new AppError(503, 'connector_unavailable', 'The connector cannot be reached.');
      }
      const answer = await client.sealMail({
        tenant: tenantOf(request).id,
        host: held.host,
        port: held.port as 465 | 587,
        username: held.username,
        password,
      });
      if ('refused' in answer) {
        throw new AppError(503, answer.refused.code, 'The connector cannot seal the password now.');
      }
      await setMailPassword(trx, held.id, answer.answer.sealed, principalId);
      return read(await mailChannel(trx));
    },

    /** A test to the caller's own verified address alone, by whatever relay is chosen (EM-P). */
    testMailChannel: async (
      _request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<MailTestQueued> => {
      if (!(await mailableAddress(trx, principalId))) {
        throw new AppError(
          409,
          'mail_no_verified_address',
          'Your own address is not one your provider has verified, so no test can be sent to it.',
        );
      }
      return { id: await queueTestMail(trx, principalId) };
    },

    listMail: async (request: FastifyRequest, { trx }: Authorised): Promise<MailList> => {
      const query = request.query as MailListQuery;
      const after = afterCursor(query.cursor);
      const page = await listMail(trx, {
        ...(after === undefined ? {} : { after }),
        limit: pageLimit(query.limit),
      });
      return {
        items: page.items.map((each) => ({
          id: each.id,
          purpose: each.purpose,
          state: each.state,
          droppedReason: each.droppedReason,
          attempts: each.attempts,
          createdAt: each.createdAt.toISOString(),
          nextAt: each.nextAt && each.nextAt.toISOString(),
          last: each.last && { ...each.last, at: each.last.at.toISOString() },
        })),
        next: cursorAfter(page.after),
        counts: await mailCounts(trx),
      };
    },
  };
}
