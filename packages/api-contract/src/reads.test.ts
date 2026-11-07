import { describe, expect, it } from 'vitest';
import { buildOpenApi } from './openapi.js';
import { allRoutes } from './routes.js';

/**
 * The routes whose answer is easiest to mistake for metadata (the SA plan, SA-E): each carries a body,
 * a caption, a field value, a version note, an approval reason, SQL, a delivery's contents or bytes.
 */
const DOUBTFUL_CONTENT = [
  // Typed by a person beside a name: values, credits, phrases, descriptions, wording, notes (SAa's review).
  'getVocabulary',
  'refreshVocabulary',
  'importVocabulary',
  'getAssetRights',
  'setAssetRights',
  'listGuardrails',
  'setGuardrail',
  'retireGuardrail',
  'listWebhooks',
  'getWebhook',
  'createWebhook',
  'changeWebhook',
  'rotateWebhookSecret',
  'listServiceIdentities',
  'createServiceIdentity',
  'changeServiceIdentity',
  'disableServiceIdentity',
  'listLicences',
  'getLicence',
  'getTranslationSettings',
  'setTranslationSettings',
  'getTranslationSettingsHistory',
  // A source's own failure message, which can echo its rows.
  'testConnection',
  'checkBindings',
  'resolveBindings',
  'setConnectionCredential',
  // Search: snippets.
  'search',
  'searchImportParts',
  // Document reads: field values, parameters, captions, texts.
  'getDocument',
  'getDocumentParameters',
  'getNumbering',
  'getContributions',
  'getDocumentTexts',
  'getDocumentBindings',
  'getPublicationBindings',
  'getBoundTableRows',
  'getDocumentDataset',
  // Changes since and comparisons.
  'listChangesSince',
  'compareComponentVersions',
  'compareDocumentVersions',
  'compareBaseline',
  'compareBaselineResolved',
  'compareComponentLine',
  'getComponentTranslationChanges',
  // Previews and pages.
  'previewPlacement',
  'previewRestore',
  'previewDocumentRestore',
  'previewTemplateMove',
  'getRangePreview',
  'getRangePage',
  'getPublicationRequest',
  // Shared outputs, every download and export.
  'getPublication',
  'getSharedOutput',
  'getAssetVersionContent',
  'getAssetVersionDerivative',
  'downloadJob',
  'downloadTenantExport',
  'downloadAuditExport',
  'downloadDocumentTranslationJob',
  'exportBibliographyEntries',
  'exportTerms',
  'exportVocabulary',
  'exportThemeCatalogue',
  // Query definitions: SQL.
  'getQueryDefinition',
  // Mail and webhook deliveries.
  'listMail',
  'listWebhookDeliveries',
  'getWebhookDelivery',
  // Version and approval lists: notes and reasons.
  'listComponentVersions',
  'listDocumentVersions',
  'listComponentApprovals',
  'listDocumentApprovals',
  'listQueryDefinitionApprovals',
  'listPromptApprovals',
  'listTermApprovals',
] as const;

const byId = new Map(allRoutes.map((route) => [route.operationId, route]));

describe('what a route reads', () => {
  it('declares content, metadata or none on every route', () => {
    for (const route of allRoutes) {
      expect(['content', 'metadata', 'none'], route.operationId).toContain(route.reads);
    }
  });

  it('holds every route that is easy to mistake for metadata as content', () => {
    for (const operationId of DOUBTFUL_CONTENT) {
      expect(byId.get(operationId)?.reads, operationId).toBe('content');
    }
  });

  it('counts a route answering bytes or a model stream as content', () => {
    // The query runs CSV is diagnostics: when, who, and what ran, by name.
    const exempt = new Set(['openStream', 'getQueryRunsCsv']);
    for (const route of allRoutes) {
      if (exempt.has(route.operationId)) continue;
      const answers = Object.entries(route.responses).filter(([status]) => Number(status) < 300);
      if (
        answers.some(([, response]) => response.binary !== undefined || response.stream === true)
      ) {
        expect(route.reads, route.operationId).toBe('content');
      }
    }
  });

  it('keeps the event stream to metadata: ids, state names and presence', () => {
    expect(byId.get('openStream')?.reads).toBe('metadata');
  });

  it('publishes what each operation reads in the OpenAPI document', () => {
    const document = buildOpenApi(allRoutes);
    for (const route of allRoutes) {
      const operation = document.paths[route.path]?.[route.method.toLowerCase()] as {
        'x-alloy-reads'?: string;
      };
      expect(operation['x-alloy-reads'], route.operationId).toBe(route.reads);
    }
  });
});
