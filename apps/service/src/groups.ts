import type {
  GroupBody,
  GroupDeleted,
  GroupList,
  GroupListQuery,
  GroupMade,
  GroupMembersBody,
  GroupParams,
  GroupView,
} from '@alloy-works/api-contract';
import {
  createGroup,
  deleteGroup,
  countGroups,
  groupGrantsInForce,
  listGroups,
  readGroup,
  setGroupMembers,
  type ListedGroup,
  type SetMembersAnswer,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { refuseBeyondHoldingAt } from './grant-limits.js';
import { afterCursor, cursorAfter, pageLimit } from './components.js';
import type { AppError } from './errors.js';
import { refused } from './wire-codes.js';

/** A group as the API shows it. */
function groupView(group: ListedGroup): GroupView {
  return {
    id: group.id,
    name: group.name,
    source: group.source,
    providerValue: group.providerValue,
    members: group.members.map((member) => ({ ...member })),
  };
}

type GroupRefusal =
  | 'group.name_taken'
  | 'group.value_taken'
  | 'group.provider_required'
  | 'group.provider_unknown'
  | Exclude<Extract<SetMembersAnswer, { refused: string }>['refused'], 'group.missing'>;

/** What each refusal says, for a person managing groups rather than for somebody reading the code. */
const REFUSALS = new Map<GroupRefusal, string>([
  ['group.name_taken', 'There is already a group with that name.'],
  ['group.value_taken', 'There is already a group standing for that value.'],
  [
    'group.provider_required',
    'More than one sign-in provider is open, so say which one this group reads.',
  ],
  ['group.provider_unknown', 'There is no such open sign-in provider here.'],
  [
    'group.from_provider',
    "This group's members are whoever the organisation's sign-in says are in it, so they cannot be named here.",
  ],
  ['group.member_missing', 'There is no such person in this environment.'],
  ['group.member_erased', 'Somebody chosen was erased, and joins no group again.'],
  [
    'grant.external_at_tenant',
    'This group holds access to the whole environment, which someone from outside the organisation cannot be given.',
  ],
  [
    'grant.external_capped',
    'This group holds a role someone from outside the organisation cannot be allowed.',
  ],
  [
    'grant.external_past_cap',
    'This group holds access for longer than this environment allows for someone from outside the organisation.',
  ],
]);

function refuse(refusal: GroupRefusal): AppError {
  return refused(409, refusal, REFUSALS.get(refusal)!);
}

/**
 * The handlers for groups, each run in the transaction `administer` at the tenant was decided in:
 * FOR UPDATE on the epoch where the route changes access, which setting members and deleting do.
 */
export function groupHandlers() {
  return {
    listGroups: async (request: FastifyRequest, { trx }: Authorised): Promise<GroupList> => {
      const query = request.query as GroupListQuery;
      const after = afterCursor(query.cursor);
      const page = await listGroups(trx, {
        ...(after === undefined ? {} : { after }),
        limit: pageLimit(query.limit),
      });
      return {
        items: page.items.map(groupView),
        next: cursorAfter(page.after),
        total: await countGroups(trx),
      };
    },

    createGroup: async (request: FastifyRequest, { trx }: Authorised): Promise<GroupMade> => {
      const body = request.body as GroupBody;
      const answer = await createGroup(
        trx,
        body.name,
        body.providerValue === undefined
          ? {}
          : {
              providerValue: body.providerValue,
              ...(body.provider === undefined ? {} : { providerId: body.provider }),
            },
      );
      if ('refused' in answer) throw refuse(answer.refused);
      const made = await readGroup(trx, answer.group.id);
      return { group: groupView(made ?? { ...answer.group, members: [] }) };
    },

    setGroupMembers: async (
      request: FastifyRequest,
      authorised: Authorised,
    ): Promise<GroupMade> => {
      const { trx } = authorised;
      const { id } = request.params as GroupParams;
      const { principals } = request.body as GroupMembersBody;
      // A group holding more than its maker is not theirs to change (GL-C, GL-D). An unchanged list
      // changes nothing, and the source of a group from a provider refuses it anyway.
      const before = await readGroup(trx, id);
      const wanted = new Set(principals);
      if (
        before &&
        (before.members.length !== wanted.size ||
          before.members.some((member) => !wanted.has(member.id)))
      ) {
        await refuseBeyondHoldingAt(trx, authorised, await groupGrantsInForce(trx, id));
      }
      const answer = await setGroupMembers(trx, id, principals);
      if ('refused' in answer) {
        if (answer.refused === 'group.missing') throw notFound();
        throw refuse(answer.refused);
      }
      const group = await readGroup(trx, id);
      if (!group)
        throw new Error('A group whose members were set in this transaction was not there');
      return { group: groupView(group) };
    },

    deleteGroup: async (request: FastifyRequest, authorised: Authorised): Promise<GroupDeleted> => {
      const { trx } = authorised;
      const { id } = request.params as GroupParams;
      await refuseBeyondHoldingAt(trx, authorised, await groupGrantsInForce(trx, id));
      const answer = await deleteGroup(trx, id);
      if ('refused' in answer && answer.refused === 'group.in_scope') {
        throw refused(409, 'group.in_scope', 'A scope names this group to accept a revision.');
      }
      if ('refused' in answer) throw notFound();
      return answer;
    },
  };
}
