import {
  changeScimGroup,
  changeScimUser,
  createScimGroup,
  createScimUser,
  deleteScimGroup,
  deleteScimUser,
  findApiToken,
  lockAccessForChange,
  notifyTenant,
  providerProvisionedBy,
  scimGroup,
  scimGroups,
  scimUser,
  scimUsers,
  type setAuditContext,
  type ScimGroup,
  type ScimRefusal,
  type ScimUser,
  type ScimUserFields,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashToken } from './sessions.js';
import { bearerSecret, isBearer } from './tokens.js';

/**
 * **SCIM 2.0** (RFC 7643, RFC 7644; identity.md, "SCIM"; the ID plan, IDc): the subset Entra ID and Okta
 * use, at `/scim/v2/` on the environment's hostname, outside `/v1` and the generated client. Its bearer
 * token is that of the provider's service identity (IN-K), found only in the environment whose hostname
 * this is, so another's is simply not there (IAM-003). Everything reads and writes one provider's people.
 */

export const SCIM_ROOT = '/scim/v2';
const SCHEMA = {
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  list: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  patch: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  error: 'urn:ietf:params:scim:api:messages:2.0:Error',
  config: 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
  resourceType: 'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
  schema: 'urn:ietf:params:scim:schemas:core:2.0:Schema',
} as const;
const CONTENT_TYPE = 'application/scim+json';
const MOST_RESULTS = 200;

/** Every path served, which `scim.test.ts` holds to the design's subset. */
export const SCIM_PATHS = [
  'GET /ServiceProviderConfig',
  'GET /ResourceTypes',
  'GET /Schemas',
  'GET /Users',
  'POST /Users',
  'GET /Users/:id',
  'PUT /Users/:id',
  'PATCH /Users/:id',
  'DELETE /Users/:id',
  'GET /Groups',
  'POST /Groups',
  'GET /Groups/:id',
  'PUT /Groups/:id',
  'PATCH /Groups/:id',
  'DELETE /Groups/:id',
] as const;

class ScimError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly scimType?: string,
  ) {
    super(message);
  }
}

const invalid = (message: string, scimType = 'invalidValue') =>
  new ScimError(400, message, scimType);
const notThere = () => new ScimError(404, 'No such resource.');

function refused(refusal: ScimRefusal): ScimError {
  switch (refusal) {
    case 'scim.taken':
      return new ScimError(409, 'That resource exists already.', 'uniqueness');
    case 'scim.erased':
      return new ScimError(409, 'That person was erased from this environment.', 'uniqueness');
    case 'scim.missing':
      return notThere();
    case 'scim.unknown_member':
      return invalid('A member named is not somebody this provider has provisioned.');
  }
}

/** Entra ID says `"False"`; RFC 7643 says `false`. Both mean the same here. */
const truth = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && /^(true|false)$/i.test(value)) {
    return value.toLowerCase() === 'true';
  }
  return undefined;
};

const Text = z.string().trim().min(1).max(500);

const UserBody = z.looseObject({
  externalId: Text,
  userName: Text,
  displayName: z.string().max(500).nullish(),
  name: z
    .looseObject({
      formatted: z.string().max(500).nullish(),
      givenName: z.string().max(500).nullish(),
      familyName: z.string().max(500).nullish(),
    })
    .nullish(),
  emails: z
    .array(z.looseObject({ value: z.string().max(254).nullish(), primary: z.unknown().optional() }))
    .max(50)
    .nullish(),
  active: z.unknown().optional(),
});

const nameFrom = (body: z.infer<typeof UserBody>): string | null => {
  const given = [body.name?.givenName, body.name?.familyName].filter(Boolean).join(' ');
  return body.displayName?.trim() || body.name?.formatted?.trim() || given.trim() || null;
};

const emailFrom = (body: z.infer<typeof UserBody>): string | null => {
  const all = body.emails ?? [];
  const chosen = all.find((each) => truth(each.primary) === true) ?? all[0];
  return chosen?.value?.trim() || null;
};

function userFields(input: unknown): ScimUserFields {
  const parsed = UserBody.safeParse(input);
  if (!parsed.success) throw invalid('A user needs an externalId and a userName.');
  return {
    externalId: parsed.data.externalId,
    userName: parsed.data.userName,
    displayName: nameFrom(parsed.data),
    email: emailFrom(parsed.data),
    active: parsed.data.active === undefined ? true : (truth(parsed.data.active) ?? true),
  };
}

const GroupBody = z.looseObject({
  displayName: Text,
  externalId: z.string().trim().min(1).max(500).nullish(),
  members: z
    .array(z.looseObject({ value: z.uuid() }))
    .max(10_000)
    .nullish(),
});

const PatchBody = z.looseObject({
  Operations: z
    .array(
      z.looseObject({
        op: z.string(),
        path: z.string().max(500).optional(),
        value: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(1000),
});
type PatchOperation = z.infer<typeof PatchBody>['Operations'][number];

function operations(input: unknown): readonly PatchOperation[] {
  const parsed = PatchBody.safeParse(input);
  if (!parsed.success) throw invalid('A patch needs its Operations.');
  return parsed.data.Operations;
}

const opOf = (operation: PatchOperation): 'add' | 'replace' | 'remove' => {
  const op = operation.op.toLowerCase();
  if (op === 'add' || op === 'replace' || op === 'remove') return op;
  throw invalid('A patch operation is add, replace or remove.');
};

/** A person's fields with a patch's operations applied: `active`, names and emails, as Entra and Okta send. */
function patchedUser(held: ScimUser, patch: readonly PatchOperation[]): ScimUserFields {
  let fields: ScimUserFields = {
    externalId: held.externalId,
    userName: held.userName,
    displayName: held.displayName,
    email: held.email,
    active: held.active,
  };
  const set = (path: string, value: unknown) => {
    const key = path.toLowerCase();
    const text = typeof value === 'string' ? value.trim() : null;
    if (key === 'active') {
      const active = truth(value);
      if (active === undefined) throw invalid('active is true or false.');
      fields = { ...fields, active };
    } else if (key === 'displayname' || key === 'name.formatted') {
      fields = { ...fields, displayName: text || null };
    } else if (key === 'username') {
      if (!text) throw invalid('userName cannot be empty.');
      fields = { ...fields, userName: text };
    } else if (key === 'externalid') {
      if (!text) throw invalid('externalId cannot be empty.');
      fields = { ...fields, externalId: text };
    } else if (key === 'emails' || key.startsWith('emails[')) {
      const email = Array.isArray(value)
        ? (value as { value?: unknown }[]).find((each) => typeof each.value === 'string')?.value
        : key.endsWith('.value')
          ? value
          : (value as { value?: unknown } | null | undefined)?.value;
      fields = { ...fields, email: typeof email === 'string' ? email.trim() || null : null };
    }
    // Anything else of the core schema has nowhere to be kept here, and is taken without complaint.
  };
  for (const operation of patch) {
    const op = opOf(operation);
    if (operation.path === undefined) {
      if (op === 'remove') throw invalid('A remove names its path.', 'noTarget');
      if (typeof operation.value !== 'object' || operation.value === null) {
        throw invalid('An operation with no path carries an object.');
      }
      for (const [path, value] of Object.entries(operation.value)) set(path, value);
    } else {
      set(operation.path, op === 'remove' ? null : operation.value);
    }
  }
  return fields;
}

/** A group's fields with a patch applied: its name, and members added or removed as Entra and Okta do. */
function patchedGroup(held: ScimGroup, patch: readonly PatchOperation[]) {
  let displayName = held.displayName;
  let externalId = held.externalId;
  const members = new Set(held.members.map((each) => each.id));
  const values = (value: unknown): string[] => {
    const list = Array.isArray(value) ? value : [value];
    return list.map((each) => {
      const id = (each as { value?: unknown } | null)?.value;
      if (typeof id !== 'string' || !z.uuid().safeParse(id).success) {
        throw invalid('A member is named by the value SCIM was given for them.');
      }
      return id;
    });
  };
  for (const operation of patch) {
    const op = opOf(operation);
    const path = operation.path?.toLowerCase();
    const one = /^members\[value eq "([0-9a-f-]+)"\]$/i.exec(operation.path ?? '');
    if (one) {
      if (op === 'remove') members.delete(one[1]!);
      else members.add(one[1]!);
    } else if (path === 'members') {
      if (op === 'remove' && operation.value === undefined) members.clear();
      else if (op === 'remove') for (const id of values(operation.value)) members.delete(id);
      else {
        if (op === 'replace') members.clear();
        for (const id of values(operation.value)) members.add(id);
      }
    } else if (path === 'displayname' && typeof operation.value === 'string') {
      displayName = operation.value.trim();
    } else if (path === 'externalid') {
      externalId = typeof operation.value === 'string' ? operation.value.trim() || null : null;
    } else if (path === undefined && typeof operation.value === 'object' && operation.value) {
      const whole = operation.value as Record<string, unknown>;
      if (typeof whole['displayName'] === 'string') displayName = whole['displayName'].trim();
      if (typeof whole['externalId'] === 'string') externalId = whole['externalId'].trim();
      if (whole['members'] !== undefined) {
        if (op === 'replace') members.clear();
        for (const id of values(whole['members'])) members.add(id);
      }
    } else {
      throw invalid('That is not a path of a group this takes.', 'invalidPath');
    }
  }
  if (displayName === '') throw invalid('displayName cannot be empty.');
  return { displayName, externalId, members: [...members] };
}

/** `attribute eq "value"`: the one filter this takes, of the attributes it names. */
function filterOf(
  raw: unknown,
  attributes: readonly string[],
): { readonly attribute: string; readonly value: string } | undefined {
  if (raw === undefined) return undefined;
  const match = typeof raw === 'string' ? /^\s*(\w+)\s+eq\s+"([^"]*)"\s*$/i.exec(raw) : null;
  const attribute =
    match && attributes.find((each) => each.toLowerCase() === match[1]!.toLowerCase());
  if (!match || !attribute) {
    throw invalid(`The filter takes ${attributes.join(' or ')} with eq.`, 'invalidFilter');
  }
  return { attribute, value: match[2]! };
}

function pageOf(query: Record<string, unknown>): {
  readonly offset: number;
  readonly limit: number;
  readonly start: number;
} {
  const whole = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return value === undefined || !Number.isInteger(parsed) ? fallback : parsed;
  };
  const start = Math.max(1, whole(query['startIndex'], 1));
  const limit = Math.min(MOST_RESULTS, Math.max(0, whole(query['count'], 100)));
  return { offset: start - 1, limit, start };
}

const listed = (items: readonly unknown[], total: number, start: number) => ({
  schemas: [SCHEMA.list],
  totalResults: total,
  startIndex: start,
  itemsPerPage: items.length,
  Resources: items,
});

const metaOf = (root: string, kind: 'Users' | 'Groups', id: string, created: Date) => ({
  resourceType: kind === 'Users' ? 'User' : 'Group',
  created: created.toISOString(),
  location: `${root}/${kind}/${id}`,
});

function userView(root: string, user: ScimUser) {
  return {
    schemas: [SCHEMA.user],
    id: user.id,
    externalId: user.externalId,
    userName: user.userName,
    ...(user.displayName === null
      ? {}
      : { displayName: user.displayName, name: { formatted: user.displayName } }),
    ...(user.email === null ? {} : { emails: [{ value: user.email, primary: true }] }),
    active: user.active,
    meta: metaOf(root, 'Users', user.id, user.createdAt),
  };
}

function groupView(root: string, group: ScimGroup) {
  return {
    schemas: [SCHEMA.group],
    id: group.id,
    displayName: group.displayName,
    ...(group.externalId === null ? {} : { externalId: group.externalId }),
    members: group.members.map((member) => ({
      value: member.id,
      $ref: `${root}/Users/${member.id}`,
      ...(member.name === null ? {} : { display: member.name }),
    })),
    meta: metaOf(root, 'Groups', group.id, group.createdAt),
  };
}

const CONFIG = {
  schemas: [SCHEMA.config],
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: MOST_RESULTS },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    {
      type: 'oauthbearertoken',
      name: 'Bearer token',
      description:
        "The token of the provider's service identity, made in Administration's Sign-in.",
    },
  ],
};

const RESOURCE_TYPES = [
  {
    schemas: [SCHEMA.resourceType],
    id: 'User',
    name: 'User',
    endpoint: '/Users',
    schema: SCHEMA.user,
  },
  {
    schemas: [SCHEMA.resourceType],
    id: 'Group',
    name: 'Group',
    endpoint: '/Groups',
    schema: SCHEMA.group,
  },
];

const attribute = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
  name,
  type,
  multiValued: false,
  required: false,
  caseExact: false,
  mutability: 'readWrite',
  returned: 'default',
  uniqueness: 'none',
  ...extra,
});

const SCHEMAS = [
  {
    schemas: [SCHEMA.schema],
    id: SCHEMA.user,
    name: 'User',
    attributes: [
      attribute('userName', 'string', { required: true, uniqueness: 'server' }),
      attribute('externalId', 'string', { required: true, caseExact: true }),
      attribute('displayName', 'string'),
      attribute('name', 'complex'),
      attribute('emails', 'complex', { multiValued: true }),
      attribute('active', 'boolean'),
    ],
  },
  {
    schemas: [SCHEMA.schema],
    id: SCHEMA.group,
    name: 'Group',
    attributes: [
      attribute('displayName', 'string', { required: true, uniqueness: 'server' }),
      attribute('externalId', 'string', { caseExact: true }),
      attribute('members', 'complex', { multiValued: true }),
    ],
  },
];

interface Holder {
  readonly tenant: Tenant;
  readonly providerId: string;
  readonly context: Parameters<typeof setAuditContext>[1];
  readonly root: string;
}

const sayEnded = async (
  trx: TenantTransaction,
  ended: { readonly sessions: readonly string[]; readonly tokens: readonly string[] },
) => {
  for (const session of ended.sessions) {
    await notifyTenant(trx, { kind: 'credential_ended', session });
  }
  for (const token of ended.tokens) {
    await notifyTenant(trx, { kind: 'credential_ended', token });
  }
};

/** Serves SCIM. A request's body is never logged: it names people. */
export function registerScim(
  app: FastifyInstance,
  options: {
    readonly db: TenantDatabase;
    readonly resolve: (hostname: string) => Promise<Tenant | undefined>;
  },
): void {
  const { db, resolve } = options;

  app.addContentTypeParser(CONTENT_TYPE, { parseAs: 'string' }, (_request, body, done) => {
    // Nothing parsed is nothing valid: each route says so in SCIM's shape, as Fastify's parser would not.
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, undefined);
    }
  });

  /** Whose token this is, in this environment, and the open provider it provisions for. */
  async function holder(request: FastifyRequest): Promise<Holder> {
    const tenant = await resolve(request.hostname);
    if (!tenant) throw notThere();
    const authorization = request.headers.authorization;
    const secret =
      authorization !== undefined && isBearer(authorization)
        ? bearerSecret(authorization)
        : undefined;
    const unauthorised = new ScimError(401, 'A valid bearer token is required.');
    if (secret === undefined) throw unauthorised;
    const found = await db.withTenant(tenant, async (trx) => {
      const token = await findApiToken(trx, hashToken(secret), new Date(), request.id);
      const provider = token && (await providerProvisionedBy(trx, token.principalId));
      return token && provider && { token, provider };
    });
    if (!found) throw unauthorised;
    const label = found.token.displayName?.trim().slice(0, 400);
    return {
      tenant,
      providerId: found.provider.id,
      root: `${request.protocol}://${request.host}${SCIM_ROOT}`,
      context: {
        actorKind: 'token',
        actor: found.token.principalId,
        token: found.token.tokenId,
        traceId: request.id,
        ...(label ? { actorLabel: label } : {}),
      },
    };
  }

  /** Runs one request: authenticated, its errors in SCIM's shape, its answer as SCIM's type. */
  const route = (
    run: (
      request: FastifyRequest,
      held: Holder,
    ) => Promise<{ readonly status: number; readonly body?: unknown }>,
  ) =>
    async function serve(request: FastifyRequest, reply: FastifyReply) {
      try {
        const answer = await run(request, await holder(request));
        void reply.header('Cache-Control', 'no-store').type(CONTENT_TYPE).status(answer.status);
        return answer.body === undefined ? reply.send() : reply.send(JSON.stringify(answer.body));
      } catch (error) {
        if (!(error instanceof ScimError)) throw error;
        void reply.header('Cache-Control', 'no-store').type(CONTENT_TYPE).status(error.status);
        return reply.send(
          JSON.stringify({
            schemas: [SCHEMA.error],
            status: String(error.status),
            detail: error.message,
            ...(error.scimType === undefined ? {} : { scimType: error.scimType }),
          }),
        );
      }
    };

  /** A change, under the access epoch: it may disable somebody or change a membership (IN-B's order). */
  const changing = <T>(held: Holder, act: (trx: TenantTransaction) => Promise<T>) =>
    db.withTenant(
      held.tenant,
      async (trx) => {
        await lockAccessForChange(trx);
        return act(trx);
      },
      held.context,
    );

  const idOf = (request: FastifyRequest): string => {
    const { id } = request.params as { id: string };
    if (!z.uuid().safeParse(id).success) throw notThere();
    return id;
  };

  const at = (path: string) => `${SCIM_ROOT}${path}`;

  app.get(
    at('/ServiceProviderConfig'),
    route(async () => ({ status: 200, body: CONFIG })),
  );
  app.get(
    at('/ResourceTypes'),
    route(async () => ({
      status: 200,
      body: listed(RESOURCE_TYPES, RESOURCE_TYPES.length, 1),
    })),
  );
  app.get(
    at('/Schemas'),
    route(async () => ({ status: 200, body: listed(SCHEMAS, SCHEMAS.length, 1) })),
  );

  app.get(
    at('/Users'),
    route(async (request, held) => {
      const query = request.query as Record<string, unknown>;
      const filter = filterOf(query['filter'], ['userName', 'externalId']);
      const { offset, limit, start } = pageOf(query);
      const page = await db.withTenant(held.tenant, (trx) =>
        scimUsers(trx, held.providerId, {
          offset,
          limit,
          ...(filter === undefined
            ? {}
            : {
                filter:
                  filter.attribute === 'userName'
                    ? { userName: filter.value }
                    : { externalId: filter.value },
              }),
        }),
      );
      return {
        status: 200,
        body: listed(
          page.items.map((each) => userView(held.root, each)),
          page.total,
          start,
        ),
      };
    }),
  );
  app.post(
    at('/Users'),
    route(async (request, held) => {
      const fields = userFields(request.body);
      const answer = await changing(held, async (trx) => {
        const made = await createScimUser(trx, held.providerId, fields);
        if (!('refused' in made)) await sayEnded(trx, made.ended);
        return made;
      });
      if ('refused' in answer) throw refused(answer.refused);
      return { status: 201, body: userView(held.root, answer.user) };
    }),
  );
  app.get(
    at('/Users/:id'),
    route(async (request, held) => {
      const user = await db.withTenant(held.tenant, (trx) =>
        scimUser(trx, held.providerId, idOf(request)),
      );
      if (!user) throw notThere();
      return { status: 200, body: userView(held.root, user) };
    }),
  );
  app.put(
    at('/Users/:id'),
    route(async (request, held) => {
      const fields = userFields(request.body);
      const answer = await changing(held, async (trx) => {
        const changed = await changeScimUser(
          trx,
          held.providerId,
          idOf(request),
          fields,
          'replaced',
        );
        if (!('refused' in changed)) await sayEnded(trx, changed.ended);
        return changed;
      });
      if ('refused' in answer) throw refused(answer.refused);
      return { status: 200, body: userView(held.root, answer.user) };
    }),
  );
  app.patch(
    at('/Users/:id'),
    route(async (request, held) => {
      const patch = operations(request.body);
      const answer = await changing(held, async (trx) => {
        const stands = await scimUser(trx, held.providerId, idOf(request));
        if (!stands) throw notThere();
        const changed = await changeScimUser(
          trx,
          held.providerId,
          stands.id,
          patchedUser(stands, patch),
          'patched',
        );
        if (!('refused' in changed)) await sayEnded(trx, changed.ended);
        return changed;
      });
      if ('refused' in answer) throw refused(answer.refused);
      return { status: 200, body: userView(held.root, answer.user) };
    }),
  );
  app.delete(
    at('/Users/:id'),
    route(async (request, held) => {
      const answer = await changing(held, async (trx) => {
        const ended = await deleteScimUser(trx, held.providerId, idOf(request));
        if (!('refused' in ended)) await sayEnded(trx, ended);
        return ended;
      });
      if ('refused' in answer) throw refused(answer.refused);
      return { status: 204 };
    }),
  );

  const groupFields = (input: unknown) => {
    const parsed = GroupBody.safeParse(input);
    if (!parsed.success) throw invalid('A group needs a displayName, and members by id.');
    return {
      displayName: parsed.data.displayName,
      externalId: parsed.data.externalId?.trim() || null,
      members: (parsed.data.members ?? []).map((each) => each.value),
    };
  };

  app.get(
    at('/Groups'),
    route(async (request, held) => {
      const query = request.query as Record<string, unknown>;
      const filter = filterOf(query['filter'], ['displayName', 'externalId']);
      const { offset, limit, start } = pageOf(query);
      const page = await db.withTenant(held.tenant, (trx) =>
        scimGroups(trx, held.providerId, {
          offset,
          limit,
          ...(filter === undefined
            ? {}
            : {
                filter:
                  filter.attribute === 'displayName'
                    ? { displayName: filter.value }
                    : { externalId: filter.value },
              }),
        }),
      );
      return {
        status: 200,
        body: listed(
          page.items.map((each) => groupView(held.root, each)),
          page.total,
          start,
        ),
      };
    }),
  );
  app.post(
    at('/Groups'),
    route(async (request, held) => {
      const fields = groupFields(request.body);
      const answer = await changing(held, (trx) => createScimGroup(trx, held.providerId, fields));
      if ('refused' in answer) throw refused(answer.refused);
      return { status: 201, body: groupView(held.root, answer.group) };
    }),
  );
  app.get(
    at('/Groups/:id'),
    route(async (request, held) => {
      const group = await db.withTenant(held.tenant, (trx) =>
        scimGroup(trx, held.providerId, idOf(request)),
      );
      if (!group) throw notThere();
      return { status: 200, body: groupView(held.root, group) };
    }),
  );
  app.put(
    at('/Groups/:id'),
    route(async (request, held) => {
      const fields = groupFields(request.body);
      const answer = await changing(held, (trx) =>
        changeScimGroup(trx, held.providerId, idOf(request), fields, 'replaced'),
      );
      if ('refused' in answer) throw refused(answer.refused);
      return { status: 200, body: groupView(held.root, answer.group) };
    }),
  );
  app.patch(
    at('/Groups/:id'),
    route(async (request, held) => {
      const patch = operations(request.body);
      const answer = await changing(held, async (trx) => {
        const stands = await scimGroup(trx, held.providerId, idOf(request));
        if (!stands) throw notThere();
        return changeScimGroup(
          trx,
          held.providerId,
          stands.id,
          patchedGroup(stands, patch),
          'patched',
        );
      });
      if ('refused' in answer) throw refused(answer.refused);
      return { status: 200, body: groupView(held.root, answer.group) };
    }),
  );
  app.delete(
    at('/Groups/:id'),
    route(async (request, held) => {
      const answer = await changing(held, (trx) =>
        deleteScimGroup(trx, held.providerId, idOf(request)),
      );
      if (answer !== 'deleted') throw refused(answer);
      return { status: 204 };
    }),
  );
}
