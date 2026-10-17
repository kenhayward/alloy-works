import type {
  ShareBody,
  ShareList,
  ShareMade,
  ShareParams,
  ShareRevoked,
  SharedOutputParams,
  ShareView,
} from '@alloy-works/api-contract';
import {
  listShares,
  loadFacts,
  readPublication,
  recordSharedAccess,
  revokeShare,
  sharePublication,
  type StoredShare,
  type Tenant,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide } from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import { callerOf, notFound, scopesOf, type Authorised } from './access.js';
import type { BinaryBody } from './assets.js';
import { storageUnavailable } from './errors.js';
import { refused } from './wire-codes.js';

/** Publication shares (publishing.md, "Shares"; the R17 plan). */

export const shareView = (share: StoredShare): ShareView => ({
  id: share.id,
  recipient: { ...share.recipient },
  expiresAt: share.expiresAt.toISOString(),
  expired: share.expired,
  sharedBy: { ...share.sharedBy },
  sharedAt: share.sharedAt.toISOString(),
  accesses: share.accesses.map((each) => ({ at: each.at.toISOString(), output: each.output })),
});

/** What each output is served as, through the service, to whoever may read the publication. */
const SERVED = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  provenance: 'application/json',
  verapdf: 'application/json',
} as const;

/**
 * Whether the caller may read the publication itself, decided from the facts already held: a share
 * route takes the epoch for a change, so it decides here rather than through `authoriseAt` (the R17
 * plan, R17-C).
 */
async function mayRead(
  trx: TenantTransaction,
  request: FastifyRequest,
  publication: string,
): Promise<boolean> {
  const loaded = await loadFacts(trx, callerOf(request).principalId, {
    kind: 'artifact',
    id: publication,
  });
  return loaded !== undefined && decide('read', { ...loaded, scopes: scopesOf(request) }).allowed;
}

export function shareHandlers(
  tenantOf: (request: FastifyRequest) => Tenant,
  objects: ObjectStores | undefined,
) {
  return {
    /** `publish` on its document was decided by the route; `read` on the publication here. */
    listPublicationShares: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ShareList> => {
      const { id } = request.params as { id: string };
      if (!(await mayRead(trx, request, id))) throw notFound();
      return { shares: (await listShares(trx, id)).map(shareView) };
    },

    sharePublication: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ShareMade> => {
      const { id } = request.params as { id: string };
      const body = request.body as ShareBody;
      if (!(await mayRead(trx, request, id))) throw notFound();
      const answer = await sharePublication(trx, {
        publication: id,
        email: body.email,
        ...(body.expiresAt === undefined ? {} : { expiresAt: new Date(body.expiresAt) }),
        sharedBy: principalId,
      });
      switch (answer.answer) {
        case 'shared':
          return { share: shareView(answer.share), invited: answer.invitation !== null };
        case 'publication.missing':
          throw notFound();
        case 'share.member':
          throw refused(
            409,
            'share.member',
            'They are in the organisation: they read it through their own access.',
          );
        case 'share.invitation_waiting':
          throw refused(
            409,
            'share.invitation_waiting',
            'An administrator invited them already: ask an administrator to grant this.',
          );
        case 'share.duplicate':
          throw refused(409, 'share.duplicate', 'It is shared with them already.');
        case 'share.erased':
          throw refused(409, 'share.erased', 'That person was erased.');
        case 'share.expiry_past':
          throw refused(409, 'share.expiry_past', 'Choose an expiry after today.');
        case 'share.past_cap':
          throw refused(
            409,
            'share.past_cap',
            'Choose an earlier expiry: access from outside has a limit here.',
          );
      }
    },

    revokePublicationShare: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ShareRevoked> => {
      const { id, share } = request.params as ShareParams;
      if (!(await mayRead(trx, request, id))) throw notFound();
      const answer = await revokeShare(trx, { publication: id, share });
      if (answer.answer !== 'revoked') throw notFound();
      return { revoked: share };
    },

    /**
     * An output, through the service (the R17 plan, R17-E): `read` was decided on the publication at
     * this request, so a revoked share fetches nothing more, and saved as the publication's id and
     * format - never its title. Somebody from outside fetching it is recorded (PUB-060).
     */
    getSharedOutput: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<BinaryBody> => {
      const { id, format } = request.params as SharedOutputParams;
      const publication = await readPublication(trx, id);
      if (!publication) throw notFound();
      const key =
        format === 'verapdf'
          ? publication.outputs.find((each) => each.format === 'pdf')?.check?.report.key
          : publication.outputs.find((each) => each.format === format)?.key;
      if (key === undefined) throw notFound();
      if (!objects) throw storageUnavailable();
      const store = await objects.forTenant(trx, tenantOf(request));
      const bytes = await store.get(key);
      await recordSharedAccess(trx, { publication: id, output: format, principal: principalId });
      return {
        contentType: SERVED[format],
        bytes,
        immutable: false,
        attachment:
          format === 'verapdf'
            ? `${id}-verapdf.json`
            : format === 'provenance'
              ? `${id}-provenance.json`
              : `${id}.${format}`,
      };
    },
  };
}
