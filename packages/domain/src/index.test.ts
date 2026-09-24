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
        // What preformatted text may hold, promoted by editor 5 so the editor's panel asks the
        // walk's own rule.
        'LANGUAGE_LABEL',
        'forbiddenInPreformatted',
        'isLanguageLabel',
        // The admission pipeline, promoted in the plan that built it.
        'admissionLimits',
        'admit',
        // Promoted by editor 7, so a reader in its own workspace says what it did in the report's
        // own fixed sentences rather than in words of its own.
        'createReport',
        'readProductClipboard',
        'readerEntry',
        'writeProductClipboard',
        // Promoted by equations 1, so the editor's dialog stores Temml's output only in the form the
        // MathML reader keeps, with an overline's content and a table's alignment kept (ruling R2).
        'admitTemmlMathml',
        // And so the editor draws an equation with the words it is spoken by, read from its MathML
        // by the reader's own parser (ruling R4).
        'equationAlternative',
        // And its writing half, so the dialog stores the alternative the author settled on in the
        // same form, by the same parser (ruling R7).
        'withAlternative',
        // Assets, promoted by figures 1: the formats and limits the service refuses at the door, the
        // header walk the service and the worker both run, and an asset version's stored shape.
        'ADMITTED_FORMATS',
        'ALTERNATIVE_MAX_LENGTH',
        'ASSET_MAX_BYTES',
        'ASSET_MAX_PIXELS',
        'ASSET_SCHEMA_VERSION',
        'admittedFormat',
        'assetAlternativeSchema',
        'assetVersionSchema',
        'parseAssetVersion',
        'readImageHeader',
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
        // What the store can hold, promoted when saving an iteration began asking (issue #127).
        'storableEverywhere',
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
        // Promoted by equations 3, so the outline panel's title field tells two titles apart by the
        // canonical form the outline's digest takes, not by their words (ruling R2).
        'canonicaliseTitle',
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
        // What a document offers a reference and what one prints, promoted in the plan that builds
        // them (docs/plans/2026-09-23-cross-references-01-references-in-the-editor.md).
        'documentTargets',
        'formsFor',
        'kindWord',
        'printed',
        // And how one resolves in the document that publishes it, promoted in the plan that builds it
        // (docs/plans/2026-09-23-cross-references-02-publishing-references.md).
        'referenceResolver',
        'printableForms',
        // The forms a target is offered in, so the Reference dialog offers no title form of a section
        // whose title holds an equation, which the publish refuses (equations 3's final review, L2).
        'targetForms',
        // Publishing: the published document, its failures and assemble (publishing.md).
        'DRAFT_NOTICE',
        'PUBLISHING_SCHEMA',
        // The first slice's shape, still made for a request made before layouts (publishing 02).
        'PUBLISHING_SCHEMA_1',
        // The document under a layout before a run carried its marks: frozen, and nothing makes one
        // now (the editor's marks slice).
        'PUBLISHING_SCHEMA_2',
        // The document under a layout before a block could be a list: frozen, and nothing makes one
        // now (the editor's lists slice).
        'PUBLISHING_SCHEMA_3',
        // And the schema template 4 reads, frozen by editor 5 when quotations and preformatted text
        // made `publishing/5`.
        'PUBLISHING_SCHEMA_4',
        'PUBLISHING_SCHEMA_5',
        'PUBLISHING_SCHEMA_6',
        'PUBLISHING_SCHEMA_7',
        'PUBLISHING_SCHEMA_8',
        // Frozen by cross-references 2, which made `publishing/10`: the schema template 9 reads.
        'PUBLISHING_SCHEMA_9',
        // Frozen by equations 2, which made `publishing/11`: the schema template 10 reads.
        'PUBLISHING_SCHEMA_10',
        'assemble',
        'publishedImagePath',
        'publishFailureCodes',
        'setWithoutAGlyph',
        // The maths tree the template and the Word writer both read, from one converter, promoted by
        // equations 2 so that nothing outside the domain builds a tree by hand (ruling R2).
        'mathsTree',
        // Promoted by the editor's marks slice, so the editor can warn about a tag a publication
        // could not carry without keeping a second copy of the rule (CNT-152).
        'publishedLanguage',
        // The layout, promoted in the plan that adds it
        // (docs/plans/2026-09-19-publishing-02-the-layout.md).
        'LAYOUT_SCHEMA_VERSION',
        'PUBLISHING_FORMATS',
        'layoutSchema',
        // A layout's words alone, for a caller shown only that much of a layout - the document page
        // reads a relative reference's above and below from it (cross-references 2, ruling R9).
        'layoutWordsSchema',
        'parseLayout',
        'readLayout',
        'layoutMigrationChain',
        'defaultLayout',
        // The default layout's first version as 0018 stored it, and the sequences a layout lists,
        // promoted by tables 2 for the store's own test and the worker's.
        'FIRST_DEFAULT_LAYOUT',
        // Its second, as 0019 stored it, promoted by figures 3 when 0.3 took the default's name.
        'SECOND_DEFAULT_LAYOUT',
        // Its third, as 0021 stored it at schema 2, promoted by cross-references 2 when 0.4 took the
        // default's name.
        'THIRD_DEFAULT_LAYOUT',
        'LISTED_SEQUENCES',
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
