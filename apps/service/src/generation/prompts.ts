import type {
  CreateLibraryBody,
  LibraryParams,
  LibraryVersionBody,
  LibraryView,
  CreatePromptBody,
  PromptListQuery,
  PromptParams,
  PromptVersionBody,
  PromptView,
  SpaceParams,
} from '@alloy-works/api-contract';
import {
  createLibrary,
  libraryPrompts,
  listLibraries,
  readLibrary,
  recordLibraryVersion,
  type LibraryAnswer,
  type StoredLibrary,
  createPrompt,
  listReadablePrompts,
  readPrompt,
  recordPromptVersion,
  type PromptAnswer,
  type StoredPrompt,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide, type AccessFacts } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from '../access.js';
import { versionView } from '../components.js';
import { workflowView } from '../workflows.js';
import { cursorFor, pageAsked } from '../listing.js';
import type { SessionPrincipal } from '../sessions.js';
import { refused } from '../wire-codes.js';
import { languageOf } from '../listing.js';

/** The prompt routes (generation.md, "Prompts"; the G4 plan, G4-A). None reaches a model. */

/** A prompt as the routes answer it, with what the caller may do and where it stands (GEN-045). */
async function promptView(
  trx: TenantTransaction,
  principalId: string,
  stored: StoredPrompt,
  facts: AccessFacts,
): Promise<PromptView> {
  return {
    id: stored.id,
    space: stored.space,
    version: versionView(stored.version),
    prompt: stored.prompt,
    mayEdit: decide('edit', facts).allowed,
    ...(await workflowView(trx, stored.id, facts, principalId)),
  };
}

/** A writer's answer that is not a prompt: refused by name, or absent. */
async function refusedPrompt(
  trx: TenantTransaction,
  principalId: string,
  answer: Exclude<PromptAnswer, { prompt: StoredPrompt }>,
  facts: AccessFacts,
): Promise<never> {
  switch (answer.answer) {
    case 'prompt.refused':
      throw refused(400, 'prompt.invalid', 'The prompt is not valid.', {
        problems: answer.problems,
      });
    case 'version.precondition':
      throw refused(
        409,
        'version.precondition',
        'This prompt has a newer version than the one this page opened.',
        { current: await promptView(trx, principalId, answer.current, facts) },
      );
    case 'space.missing':
    case 'prompt.missing':
      throw notFound();
  }
}

export function promptHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    listPrompts: async (request: FastifyRequest) => {
      const query = request.query as PromptListQuery;
      const asked = pageAsked('prompts', query, languageOf(request));
      const listed = await db.withTenant(tenantOf(request), (trx) =>
        listReadablePrompts(trx, principalOf(request).principalId, asked, {
          ...(query.spaces === undefined ? {} : { spaces: query.spaces.split(',') }),
        }),
      );
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return {
        items: listed.items.map((item) => ({
          id: item.id,
          title: item.title,
          space: item.space,
          purpose: item.purpose,
          version: {
            id: item.version.id,
            number: `${item.version.revision}.${item.version.version}`,
          },
          changedAt: item.changedAt.toISOString(),
        })),
        next: cursorFor(
          'prompts',
          asked.sort,
          asked.order,
          listed.snapshot,
          listed.next,
          asked.language,
        ),
        total: listed.total,
        facets: { spaces: listed.facets.spaces.map((each) => ({ ...each })) },
      };
    },

    createPrompt: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { space } = request.params as SpaceParams;
      const { prompt } = request.body as CreatePromptBody;
      const answer = await createPrompt(trx, { author: principalId, spaceId: space, prompt });
      if (answer.answer !== 'created') {
        return refusedPrompt(
          trx,
          principalId,
          answer as Exclude<PromptAnswer, { prompt: StoredPrompt }>,
          facts,
        );
      }
      // Decided at the space, which a new prompt inherits from.
      return promptView(trx, principalId, answer.prompt, facts);
    },

    // `authorise` never looks at an artifact's kind, so another kind's id authorises cleanly here;
    // `readPrompt` answers nothing for it, and neither does this.
    getPrompt: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { id } = request.params as PromptParams;
      const stored = await readPrompt(trx, id);
      if (!stored) throw notFound();
      return promptView(trx, principalId, stored, facts);
    },

    recordPromptVersion: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ) => {
      const { id } = request.params as PromptParams;
      const body = request.body as PromptVersionBody;
      const answer = await recordPromptVersion(trx, {
        author: principalId,
        id,
        openedFrom: body.openedFrom,
        prompt: body.prompt,
      });
      if (answer.answer === 'recorded' || answer.answer === 'version.unchanged') {
        return promptView(trx, principalId, answer.prompt, facts);
      }
      return refusedPrompt(
        trx,
        principalId,
        answer as Exclude<PromptAnswer, { prompt: StoredPrompt }>,
        facts,
      );
    },
  };
}

/** A library as the routes answer it, each prompt at the revision it runs, as the caller reads it. */
async function libraryView(
  trx: TenantTransaction,
  principalId: string,
  stored: StoredLibrary,
  facts: AccessFacts,
): Promise<LibraryView> {
  return {
    id: stored.id,
    version: versionView(stored.version),
    library: stored.library,
    isDefault: stored.isDefault,
    prompts: await libraryPrompts(trx, principalId, stored.library),
    mayEdit: decide('design', facts).allowed,
  };
}

async function refusedLibrary(
  trx: TenantTransaction,
  principalId: string,
  answer: Exclude<LibraryAnswer, { library: StoredLibrary }>,
  facts: AccessFacts,
): Promise<never> {
  switch (answer.answer) {
    case 'library.refused':
      throw refused(400, 'library.invalid', 'The library is not valid.', {
        problems: answer.problems,
      });
    case 'version.precondition':
      throw refused(
        409,
        'version.precondition',
        'This library has a newer version than the one this page opened.',
        { current: await libraryView(trx, principalId, answer.current, facts) },
      );
    case 'library.missing':
      throw notFound();
  }
}

/** The prompt library routes (the G4 plan, G4-F): the environment's, `design` here changing one. */
export function promptLibraryHandlers() {
  return {
    listPromptLibraries: async (_request: FastifyRequest, { trx }: Authorised) => ({
      items: (await listLibraries(trx)).map((each) => ({
        id: each.id,
        name: each.library.name,
        isDefault: each.isDefault,
        prompts: each.library.prompts.length,
        version: { id: each.version.id, number: versionView(each.version).number },
      })),
    }),

    createPromptLibrary: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ) => {
      const { library } = request.body as CreateLibraryBody;
      const answer = await createLibrary(trx, { author: principalId, library });
      if (answer.answer !== 'created') {
        return refusedLibrary(
          trx,
          principalId,
          answer as Exclude<LibraryAnswer, { library: StoredLibrary }>,
          facts,
        );
      }
      return libraryView(trx, principalId, answer.library, facts);
    },

    getPromptLibrary: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { id } = request.params as LibraryParams;
      const stored = await readLibrary(trx, id);
      if (!stored) throw notFound();
      return libraryView(trx, principalId, stored, facts);
    },

    recordPromptLibraryVersion: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ) => {
      const { id } = request.params as LibraryParams;
      const body = request.body as LibraryVersionBody;
      const answer = await recordLibraryVersion(trx, {
        author: principalId,
        id,
        openedFrom: body.openedFrom,
        library: body.library,
      });
      if (answer.answer === 'recorded' || answer.answer === 'version.unchanged') {
        return libraryView(trx, principalId, answer.library, facts);
      }
      return refusedLibrary(
        trx,
        principalId,
        answer as Exclude<LibraryAnswer, { library: StoredLibrary }>,
        facts,
      );
    },
  };
}
