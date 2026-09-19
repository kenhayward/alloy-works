import { describe, expect, it } from 'vitest';

import * as domain from './index.js';

describe('the domain package', () => {
  it('exports the content model and the metadata rules as its public surface', () => {
    expect(Object.keys(domain).sort()).toEqual(
      [
        // The content model, promoted deliberately rather than by drift.
        'CURRENT_SCHEMA_VERSION',
        'allowedLinkSchemes',
        'alternativeSchema',
        'blockIdentifierFrom',
        'blockNodeSchema',
        'canonicalise',
        'contentDocumentSchema',
        'hasText',
        'inlineNodeSchema',
        'markSchema',
        'markTypes',
        'migrate',
        'outputMapping',
        'parseContentDocument',
        'readContent',
        // The admission pipeline, promoted in the plan that built it.
        'admissionLimits',
        'admit',
        'readProductClipboard',
        'readerEntry',
        'writeProductClipboard',
        // Metadata, promoted in the plan that built it, on the same terms.
        'DEFINITION_SCHEMA_VERSION',
        'DefinitionConflictError',
        'canonicaliseDecimal',
        'canonicaliseNotCarried',
        'canonicaliseValues',
        'carryForward',
        'checkAssignment',
        'checkSchema',
        'checkUserValues',
        'checkValue',
        'componentTypeDefinitionSchema',
        'dataTypes',
        'definitionKinds',
        'definitionsFor',
        'fieldDefinitionSchema',
        'metadataSchemaDefinitionSchema',
        'migrateDefinition',
        'principalIdsIn',
        'readDefinition',
        'resolveComponentFields',
        'validate',
        // The version record's serialisation, promoted in the storage plan that composes it.
        'canonicaliseVersion',
        'canonicaliseVersionContent',
        'componentTypeOf',
        // Access: the permission set, roles, levels, the decision and the readable set.
        'allowable',
        'checkRole',
        'decide',
        'externalCap',
        'formatLevel',
        'isPermission',
        'parseLevel',
        'permissions',
        'principalKinds',
        'readableSet',
        'sameLevel',
        'starterRoles',
        // Scaffolding, and not a decision about the content model. See CLAUDE.md.
        'componentSchema',
        'componentTypes',
        'createComponent',
        'nextVersion',
        'parseComponent',
        // The document's outline, promoted in the plan that builds it
        // (docs/plans/2026-09-18-structure-01-the-document-and-its-outline.md).
        'OUTLINE_SCHEMA_VERSION',
        'outlineDocumentSchema',
        'outlineNodeSchema',
        'sectionNodeSchema',
        'referenceNodeSchema',
        'referenceModeSchema',
        'parseOutlineDocument',
        'migrateOutline',
        'outlineMigrationChain',
        'readOutline',
        'readOutlineView',
        'withholdComponents',
        'canonicaliseOutline',
        'walkOutline',
        'applyOutlineOperation',
        'outlineOperationSchema',
        // Front matter, promoted in the plan that adds it
        // (docs/plans/2026-09-19-publishing-02-the-layout.md).
        'outlineMatterSchema',
        'mayBeFront',
        // Numbering, promoted in the plan that builds it
        // (docs/plans/2026-09-18-structure-02-numbering.md).
        'REQUIRED_SEQUENCES',
        'numberingSchemeSchema',
        'defaultNumberingScheme',
        'formatCounter',
        'contributionsOf',
        'inlineContributions',
        'resolve',
        'conditions',
        'number',
        'sectionNumbers',
        // Generated lists, promoted in the plan that builds them
        // (docs/plans/2026-09-18-structure-03-navigation.md).
        'contents',
        'listOf',
        // Publishing: the published document, its failures and assemble (publishing.md).
        'DRAFT_NOTICE',
        'PUBLISHING_SCHEMA',
        // The first slice's shape, still made for a request made before layouts (publishing 02).
        'PUBLISHING_SCHEMA_1',
        'assemble',
        'publishFailureCodes',
        // The layout, promoted in the plan that adds it
        // (docs/plans/2026-09-19-publishing-02-the-layout.md).
        'LAYOUT_SCHEMA_VERSION',
        'PUBLISHING_FORMATS',
        'layoutSchema',
        'parseLayout',
        'readLayout',
        'layoutMigrationChain',
        'defaultLayout',
        'speaksFor',
        'unsupportedFormats',
      ].sort(),
    );
  });

  it('CNT-010 exposes one entry point that validates, and no way round it', () => {
    expect(typeof domain.parseContentDocument).toBe('function');
    expect(domain).not.toHaveProperty('unsafeParseContentDocument');
  });
});
