import type {
  CreateTemplateBody,
  SpaceParams,
  TemplateListQuery,
  TemplateParams,
  TemplateVersionBody,
  TemplateView,
} from '@alloy-works/api-contract';
import { cursorFor, pageAsked } from './listing.js';
import {
  createTemplate,
  listReadableTemplates,
  readTemplate,
  recordTemplateVersion,
  type StoredTemplate,
  type Tenant,
  type TenantDatabase,
  type TemplateAnswer,
} from '@alloy-works/db';
import { decide, type AccessFacts } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { versionView } from './components.js';
import type { SessionPrincipal } from './sessions.js';
import { refused } from './wire-codes.js';

/** A template as the routes answer it, with whether the caller may change it (TPL-006). */
function templateView(template: StoredTemplate, facts: AccessFacts): TemplateView {
  return {
    id: template.id,
    space: template.space,
    version: versionView(template.version),
    definition: template.definition as unknown as Record<string, unknown>,
    mayDesign: decide('design', facts).allowed,
  };
}

/**
 * What a template's writers answer that is not a template: refused by name, the space or template gone
 * as absent. `facts` decide whether the template answered in a precondition may be changed.
 */
function refusedTemplate(
  answer: Exclude<TemplateAnswer, { template: StoredTemplate }>,
  facts: AccessFacts,
): never {
  switch (answer.answer) {
    case 'template.unresolved':
      throw refused(
        400,
        'template.unresolved',
        'This template names a theme, layout, schema or field that does not resolve.',
        { unresolved: answer.unresolved },
      );
    case 'version.precondition':
      throw refused(
        409,
        'version.precondition',
        'This template has a newer version than the one this page opened.',
        { current: templateView(answer.current, facts) },
      );
    case 'space.missing':
    case 'template.missing':
      throw notFound();
  }
}

/** The template routes (templates.md, "Routes"). */
export function templateHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    listTemplates: async (request: FastifyRequest) => {
      const asked = pageAsked('templates', request.query as TemplateListQuery);
      const listed = await db.withTenant(tenantOf(request), (trx) =>
        listReadableTemplates(trx, principalOf(request).principalId, asked),
      );
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return {
        items: listed.items.map((item) => ({
          id: item.id,
          name: item.name,
          space: item.space,
          version: {
            id: item.version.id,
            number: `${item.version.revision}.${item.version.version}`,
          },
          changedAt: item.changedAt.toISOString(),
        })),
        next: cursorFor('templates', asked.sort, asked.order, listed.snapshot, listed.next),
      };
    },

    createTemplate: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { space } = request.params as SpaceParams;
      const body = request.body as CreateTemplateBody;
      const answer = await createTemplate(trx, {
        spaceId: space,
        definition: body.definition,
        author: principalId,
      });
      if (answer.answer !== 'created') {
        return refusedTemplate(
          answer as Exclude<TemplateAnswer, { template: StoredTemplate }>,
          facts,
        );
      }
      return templateView(answer.template, facts);
    },

    // `authorise` never looks at an artifact's kind, so a document's id authorises cleanly here;
    // `readTemplate` answers nothing for it, and neither does this.
    getTemplate: async (request: FastifyRequest, { trx, facts }: Authorised) => {
      const { id } = request.params as TemplateParams;
      const template = await readTemplate(trx, id);
      if (!template) throw notFound();
      return templateView(template, facts);
    },

    recordTemplateVersion: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ) => {
      const { id } = request.params as TemplateParams;
      const body = request.body as TemplateVersionBody;
      const answer = await recordTemplateVersion(trx, {
        templateId: id,
        openedFrom: body.openedFrom,
        definition: body.definition,
        author: principalId,
      });
      if (answer.answer === 'recorded' || answer.answer === 'version.unchanged') {
        return templateView(answer.template, facts);
      }
      return refusedTemplate(
        answer as Exclude<TemplateAnswer, { template: StoredTemplate }>,
        facts,
      );
    },
  };
}
