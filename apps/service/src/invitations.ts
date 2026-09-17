import type {
  InvitationBody,
  InvitationList,
  InvitationListQuery,
  InvitationMade,
  InvitationParams,
  InvitationView,
  InvitationWithdrawn,
} from '@alloy-works/api-contract';
import {
  invite,
  listInvitations,
  withdrawInvitation,
  type InvitationRefusal,
  type StoredInvitation,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { afterCursor, cursorAfter, pageLimit } from './components.js';
import { AppError } from './errors.js';
import { wireCode } from './wire-codes.js';

/** An invitation as the API shows it, lapsed or not by the clock of the transaction it was read in. */
export function invitationView(stored: StoredInvitation, now: Date): InvitationView {
  return {
    id: stored.id,
    email: stored.email,
    person: stored.principalId,
    external: stored.kind === 'external',
    invitedBy: stored.invitedBy,
    createdAt: stored.createdAt.toISOString(),
    expiresAt: stored.expiresAt && stored.expiresAt.toISOString(),
    lapsed: stored.acceptedAt === null && stored.expiresAt !== null && stored.expiresAt <= now,
    acceptedAt: stored.acceptedAt && stored.acceptedAt.toISOString(),
    acceptedThrough: stored.acceptedThrough,
  };
}

const REFUSALS = new Map<InvitationRefusal | 'invitation.accepted', string>([
  [
    'invitation.signed_in',
    'Somebody with that address has already signed in. Choose them and give them access directly.',
  ],
  [
    'invitation.kind_differs',
    'That address is already invited, and the invitation says otherwise about whether they are from outside the organisation. Withdraw it and invite them again.',
  ],
  [
    'invitation.accepted',
    'That invitation has been accepted. Remove the grants of the person who accepted it instead.',
  ],
]);

function refuse(refusal: InvitationRefusal | 'invitation.accepted'): AppError {
  return new AppError(409, wireCode(refusal), REFUSALS.get(refusal)!);
}

async function transactionNow(trx: Authorised['trx']): Promise<Date> {
  const row = await trx
    .selectNoFrom((eb) => eb.fn<Date>('now').as('now'))
    .executeTakeFirstOrThrow();
  return row.now;
}

/** The handlers for invitations, each run in the transaction `administer` at the tenant was decided in. */
export function invitationHandlers() {
  return {
    listInvitations: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<InvitationList> => {
      const query = request.query as InvitationListQuery;
      const after = afterCursor(query.cursor);
      const page = await listInvitations(trx, {
        ...(after === undefined ? {} : { after }),
        limit: pageLimit(query.limit),
      });
      const now = await transactionNow(trx);
      return {
        items: page.items.map((each) => invitationView(each, now)),
        next: cursorAfter(page.after),
      };
    },

    invite: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<InvitationMade> => {
      const body = request.body as InvitationBody;
      const answer = await invite(trx, {
        email: body.email,
        external: body.external ?? false,
        invitedBy: principalId,
      });
      if ('refused' in answer) throw refuse(answer.refused);
      return {
        invitation: invitationView(answer.invited, await transactionNow(trx)),
        renewed: answer.renewed,
      };
    },

    withdrawInvitation: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<InvitationWithdrawn> => {
      const { id } = request.params as InvitationParams;
      const answer = await withdrawInvitation(trx, id);
      if ('refused' in answer) {
        if (answer.refused === 'invitation.missing') throw notFound();
        throw refuse(answer.refused);
      }
      return answer;
    },
  };
}
