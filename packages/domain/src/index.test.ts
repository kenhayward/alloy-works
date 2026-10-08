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
        'checkTable',
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
        // Read by search's projection, to say a person's value by their name (search.md).
        'isUserValue',
        'resolveComponentFields',
        // A template's assignments at one level resolve as a component type's do (templates.md).
        'resolveAssignedFields',
        'validate',
        // The version record's serialisation, promoted in the storage plan that composes it.
        // What the store can hold, promoted when saving an iteration began asking (issue #127).
        'storableEverywhere',
        // Search's projection: what a version is found by, place by place (search.md; W6.1).
        'SEARCH_CONFIGURATIONS',
        'configurationFor',
        'entriesOf',
        'parseQuery',
        'searchKinds',
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
        // W12.1: what a personal token may be scoped to, every permission but read (TK-B).
        'tokenScopes',
        // The audit log (AU1-A): its kinds and their details, its context, and labels.
        'AccessRefusedDetail',
        'AuditContext',
        'AuditName',
        'AuditTarget',
        'auditActorKinds',
        'auditKindSpecs',
        'auditKinds',
        'isAuditKind',
        'isLabelledKind',
        'labelFor',
        'parseAuditDetail',
        'refusalReasons',
        // Scaffolding, and not a decision about the content model. See index.ts.
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
        // The binding stage and provenance.json (the B3 plan, B3-D, B3-G).
        'bind',
        'unbound',
        'publishedProvenance',
        'provenanceBytes',
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
        // Frozen by themes 1, which made `publishing/12`: the schema template 11 reads.
        'PUBLISHING_SCHEMA_11',
        // Frozen by themes 2, which made `publishing/13`: the schema template 12 reads.
        'PUBLISHING_SCHEMA_12',
        // Frozen by W14.4, which made `publishing/14`: the schema template 13 reads.
        'PUBLISHING_SCHEMA_13',
        // Frozen by W14.5, which made `publishing/15`: the schema template 14 reads.
        'PUBLISHING_SCHEMA_14',
        // Frozen by TB1.2, which made `publishing/16`: the schema template 15 reads.
        'PUBLISHING_SCHEMA_15',
        'PUBLISHING_SCHEMA_16',
        'PUBLISHING_SCHEMA_17',
        'assemble',
        'publishedImagePath',
        'publishFailureCodes',
        'setWithoutAGlyph',
        // W8.6: the glyph check, which the editor marks a character a publish would fail on by.
        'characterProblems',
        // The maths tree the template and the Word writer both read, from one converter, promoted by
        // equations 2 so that nothing outside the domain builds a tree by hand (ruling R2).
        'mathsTree',
        // The characters the tree sets on its own account, promoted by themes 1 so the worker's test
        // holds the maths face to them rather than to a copy (STY-074).
        'MATHS_CHARACTERS',
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
        // Its fourth, as 0023 stored it at schema 3, promoted by themes 2 when 0.5 took the
        // default's name.
        'FOURTH_DEFAULT_LAYOUT',
        'LISTED_SEQUENCES',
        'speaksFor',
        'unsupportedFormats',
        // The theme, promoted by themes 1 (ruling R1), as ADR-0014 said publishing work would: its
        // shapes' kinds, places, roles and marks, the reader and its codes, the default theme the
        // store seeds, and the three projections with the run rules Word needs.
        'CATALOGUE_KINDS',
        'CATALOGUE_SCHEMA_VERSION',
        'PLACES',
        'ROLES',
        'STYLED_MARKS',
        'THEME_SCHEMA_VERSION',
        'readCatalogue',
        'readTheme',
        'themeRefusalCodes',
        'DEFAULT_CATALOGUES',
        'DEFAULT_CATALOGUES_BY_VERSION',
        'DEFAULT_CATALOGUE_VERSIONS',
        'DEFAULT_THEME',
        'projectTypst',
        // Themes 2 (ruling R1): the units an image style is given in, the upgrade the reader reads a
        // catalogue/1 by, the default theme's 0.1 frozen as 0024 stored it beside its 0.2 and 0.2's
        // fixed version, and publishing/12's projection, frozen with template 12.
        'IMAGE_UNITS',
        'upgradeCatalogue1',
        'FIRST_DEFAULT_CATALOGUES',
        'FIRST_DEFAULT_CATALOGUES_BY_VERSION',
        'FIRST_DEFAULT_CATALOGUE_VERSIONS',
        'FIRST_DEFAULT_THEME',
        'DEFAULT_THEME_VERSION',
        'projectTypst12',
        'projectCss',
        // W8.2: the canvas as the theme's rules name it, which the editor's stylesheet test reads.
        'CANVAS',
        // W8.1 (themes.md, "The theme in the editor"): the faces a theme names, declared for the
        // renderer, and the page's two lengths an image style is a share of, which the service computes
        // for it, with the size an image is set at by its style, which W8.2's editor sets figures by.
        'faceFamily',
        'projectFontFaces',
        'publishedPdf',
        'styledSize',
        'textBlockHeight',
        'textMeasure',
        'projectStylesXml',
        'markStyleId',
        'runFormat',
        'wordRun',
        // Word 1 (ruling R5): the default theme's 0.2 frozen as 0025 stored it, beside its 0.3.
        'SECOND_DEFAULT_THEME',
        'SECOND_DEFAULT_THEME_VERSION',
        // Word 1 (ruling R4, R13): the default layout's 0.5 frozen as 0025 stored it beside its 0.6,
        // what an output's report can say and its one entry point, and the media type of each format.
        'FIFTH_DEFAULT_LAYOUT',
        // W10.1 (the preview, PV-D): the default layout's 0.6 frozen as 0027 stored it beside its 0.7.
        'SIXTH_DEFAULT_LAYOUT',
        'OUTPUT_CONTENT_TYPES',
        'OUTPUT_REPORT_KINDS',
        'outputReportSchema',
        'parseOutputReport',
        // Word 1 (ruling R6): the Word writer, and the version the job records it at.
        'writeDocx',
        'WORD_WRITER_VERSION',
        // Word 3 (ruling R6): a cross-reference's key beside the document, which the worker's Word
        // check and PUB-035's test read each reference's form by, as the writer does.
        'inlineReferenceKey',
        // Word 4 (ruling R3): the maths tree as OMML, which the worker's test validates in Word's
        // schema before the writer writes an equation.
        'omml',
        // A template: its definition and its resolution (templates.md, W4.1).
        'TEMPLATE_SCHEMA_VERSION',
        'resolveTemplate',
        'startingSectionSchema',
        'templateAssignmentSchema',
        'templateDefinitionSchema',
        // Its parameters, declared, checked and recorded (the TP1 plan, TP1-A to TP1-G).
        'checkDocumentParameters',
        'checkTemplateParameters',
        'documentParametersSchema',
        'MAX_TEMPLATE_PARAMETERS',
        'seedable',
        'seededValues',
        'templateParameterSchema',
        // And whether one may be a binding's argument (the TP2 plan, TP2-C).
        'argumentRefusal',
        // And the outline a document made from one starts with (templates.md, W4.2).
        'materialiseTemplate',
        // Values as a section or a document is written with them (templates.md, W4.3).
        'checkWrittenValues',
        'writtenValues',
        // What a publication of a document made from one is checked against (templates.md, W4.4).
        'missingSections',
        'valueFailures',
        // What a definition is checked against before it is written (definitions.md, W5.1).
        'assignmentConflicts',
        'brokenDefaults',
        'nameKey',
        'schemaConflicts',
        // W8.5 (themes.md, ET-H): the default theme's 0.2 catalogues frozen as 0025 stored them, and
        // its 0.3 as 0026 did, beside its 0.4.
        'SECOND_DEFAULT_CATALOGUES',
        'SECOND_DEFAULT_CATALOGUES_BY_VERSION',
        'SECOND_DEFAULT_CATALOGUE_VERSIONS',
        'THIRD_DEFAULT_THEME',
        'THIRD_DEFAULT_THEME_VERSION',
        // W14.5 (W-I): where a caption sits, the upgrade the reader reads a catalogue/2 by, and the
        // default theme's 0.4 frozen as 0034 stored it, beside its 0.5.
        'CAPTION_PLACEMENTS',
        'upgradeCatalogue2',
        'FOURTH_DEFAULT_CATALOGUES',
        'FOURTH_DEFAULT_CATALOGUES_BY_VERSION',
        'FOURTH_DEFAULT_CATALOGUE_VERSIONS',
        'FOURTH_DEFAULT_THEME',
        'FOURTH_DEFAULT_THEME_VERSION',
        'FigureRefused',
        // Data, D1: a connection's settings and their check, the data failures and their
        // attribution, the column types a describe proposes, the connector's protocol, and the
        // limits (data.md; the D1 plan).
        'CONNECTION_SCHEMA_VERSION',
        'ConnectionRefused',
        'checkConnection',
        'connectionSettingsSchema',
        'connectorIdentities',
        'parseConnection',
        'parseConnectionForWrite',
        // What a credential is bound to, and the bounds of what the connector answers (the D1 fix).
        'connectionTarget',
        'credentialContext',
        'CONNECTOR_ANSWER_MAX_BYTES',
        'MAX_COLUMNS',
        // A describe's budget, its type's bound, and the name and type a child checks each item by
        // (the D1 fix, round two).
        'DESCRIBE_BUDGET_BYTES',
        'SOURCE_TYPE_MAX_BYTES',
        'sourceNameSchema',
        'sourceTypeSchema',
        'MAX_DESCRIBED_RELATIONS',
        'dataFailure',
        'dataFailureCodes',
        'dataFailures',
        'columnTypeSchema',
        // What a describe proposes, an image for a binary column among it (the D8 plan, D8-A).
        'proposedTypeSchema',
        'SEALED',
        'SEALED_MAX_BYTES',
        'SECRET_MAX_BYTES',
        'childRequestSchema',
        'describeAnswerSchema',
        'describeRequestSchema',
        'relationSchema',
        'sealAnswerSchema',
        'sealRequestSchema',
        'testAnswerSchema',
        'testRequestSchema',
        'defaultLimits',
        'limitCeilings',
        // Data, D2: a query definition's shape and checks, PostgreSQL's lexer and binder, a
        // parameter value's check, the canonical result, the run and a SQL describe on the
        // interface, and the limits a run takes (data.md; the D2 plan).
        'DEFINITION_MAX_BYTES',
        'DefinitionRefused',
        'PARAMETER_NAME',
        'QUERY_DEFINITION_SCHEMA_VERSION',
        'checkQueryDefinition',
        'draftDefinitionSchema',
        'parameterSchema',
        'parseDraftDefinition',
        'parseQueryDefinition',
        'parseQueryDefinitionForWrite',
        'queryDefinitionSchema',
        'valueTypeSchema',
        'BindingRefused',
        'bindPostgres',
        'lexPostgres',
        'RAN_MAX_CHARACTERS',
        'checkParameterValues',
        'MAX_LIST_ITEMS',
        'MAX_TEXT_VALUE',
        'CANONICAL_FORM',
        'canonicalResultBytes',
        'compareCanonical',
        'compareCodePoints',
        'isCanonical',
        'orderRows',
        'valueProblem',
        'dataFailureSchema',
        'SOURCE_MESSAGE_MAX',
        'sourceMessage',
        'RUN_REQUEST_MAX_BYTES',
        // Base64 as a run's answer carries an image (the D8 plan, D8-B).
        'isPaddedBase64',
        'canonicalResultSchema',
        'describeSqlAnswerSchema',
        'describeSqlRequestSchema',
        'runAnswerSchema',
        'runRequestSchema',
        'effectiveLimits',
        // Data, D3: a binding's digest, where it stands, what it takes and runs with, a dataset
        // version's provenance and a dataset's identity, and the refusal of a binding in a title
        // (the D3 plan).
        'bindingDigestInput',
        'bindingsIn',
        'checkTake',
        'literalValues',
        // A binding with its document arguments substituted (the TP2 plan, TP2-A).
        'substituteDocumentArguments',
        'PROVENANCE_SCHEMA_VERSION',
        'parseProvenance',
        'parseProvenanceForWrite',
        'identityKey',
        'imageColumnTypeSchema',
        'parametersDigestInput',
        'BINDING_IN_TITLE',
        // D3's routes answer a binding and a dataset version's provenance by these shapes.
        'bindingNodeSchema',
        'provenanceSchema',
        // Data, D4: the builder's format and its checks (the tree's for a describe among them),
        // PostgreSQL's generator and its quoting of a name, a fetch bound by its kind, and the SQL
        // fallback's text by itself (the D4 plan).
        'BUILDER_FORMAT',
        'aggregates',
        'bindFetch',
        'builderFetchSchema',
        'checkBuilder',
        'checkTree',
        'comparisons',
        'generatePostgres',
        'generatedLength',
        'sqlTextSchema',
        'treeProblem',
        // B1: the one rule a value is taken by and its stored outcome, the one function it is
        // printed by and the formats it picks, the value catalogue beside the six kinds and its
        // default, and the default theme's 0.5 frozen as 0.6 replaces it (the B1 plan).
        'TAKE_FAILURES',
        'takeDigestInput',
        'takeOutcomeSchema',
        'takeValue',
        'formatValue',
        'formatsFor',
        'DEFAULT_VALUE_FORMATS',
        'VALUE_CATALOGUE_KIND',
        'valueFormatsSchema',
        'FIFTH_DEFAULT_CATALOGUES',
        'FIFTH_DEFAULT_CATALOGUES_BY_VERSION',
        'FIFTH_DEFAULT_CATALOGUE_VERSIONS',
        'FIFTH_DEFAULT_THEME',
        'FIFTH_DEFAULT_THEME_VERSION',
        // B2: whether a changed binding still asks its held result's question (the B2 plan, B2-E).
        'questionUnchanged',
        // TP2.2: the Value dialog's question compared by its parameters' spelling (TP2-D).
        'questionSpelledAlike',
        // D7: who a request runs as, and a person's role at the source (the D7 plan, D7-G).
        'assertedRoleSchema',
        'runIdentitySchema',
        // D6.1: an HTTP connection's rules, a fetch suiting its connection, the HTTP template and its
        // binder, JSON by its source text, and what a run reports it ran (the D6 plan, task 1).
        'connectionChangeProblems',
        'isBaseUrl',
        'isFreeHeaderName',
        'connectionFetchProblems',
        'httpFetchSchema',
        'BODY_MAX_DEPTH',
        'BODY_MAX_NODES',
        'bindHttp',
        'checkHttpTemplate',
        'headerValueProblem',
        'httpPartSchema',
        'httpTemplateSchema',
        'httpValueProblems',
        'HttpValueRefused',
        'percentEncode',
        'segmentProblem',
        'canonicalJsonText',
        'isJsonObject',
        'JsonNumber',
        'jsonPointerSchema',
        'pointerTo',
        'pointerTokens',
        'resolvePointer',
        'ranSchema',
        // D6.2's S3 connection, its key template, typed filters and CSV.
        'bucketHost',
        'endpointHost',
        'dataFormatSchema',
        'fileFetchSchema',
        'indexLetter',
        'letterIndex',
        'sampleDraft',
        'ranObjectSchema',
        'bindObjectKey',
        'checkObjectKey',
        'KEY_MAX_BYTES',
        'keyPairText',
        'objectKeyProblems',
        'ObjectKeyRefused',
        'objectKeySchema',
        'parseKeyPair',
        's3KeyPairSchema',
        'checkFileCondition',
        'fileConditionSchema',
        'fileFilter',
        'sortRows',
        // TB1: the bound table, its binding taking no value, its column's format and alignment, and
        // its refusal (the TB1 plan, task 1).
        'BOUND_TABLE_COLUMNS_MAX',
        'BOUND_TABLE_SORT_MAX',
        'BoundTableRefused',
        'COLUMN_ALIGNMENTS',
        'boundTableNodeSchema',
        'fieldFormatSchema',
        'readsAsANumber',
        'tableBindingSchema',
        'takes',
        // TB1: a table's cell printed by its merged format, its mismatches and its colour (task 3).
        'colouredNegative',
        'formatCell',
        'formatMismatch',
        'mergeFormat',
        // The TB1 final review (M1): whether a cell prints its value in parentheses.
        'parenthesised',
        // TB1: a bound table laid out, its row ceiling, and the product's formats and alignment by
        // type where a table style names none (task 4).
        'DEFAULT_TABLE_ALIGN',
        'DEFAULT_TABLE_FIELDS',
        'layoutTable',
        'TABLE_ROWS_MAX',
        // The TB2 final review: a result in a table's order, for the rows route to send presorted.
        'sortResult',
        // TB3.3: every row's index in a table's order, which the page letters notes by.
        'tableOrder',
        // TB3: a table's notes matched to their rows and lettered (TB3-C).
        'keyNamesTheKey',
        'matchNoteRows',
        // TB3.3: a key's value typed for a note, canonical by its column's type.
        'canonicalKeyValue',
        'placeTableNotes',
        'tableNoteLetter',
        // TB1: the types a table style formats by, the default theme's 0.6 frozen as 0.7 replaces it,
        // and the default layout's 0.7 frozen as 0.8 does (task 5).
        'FIELD_KEYS',
        'SEVENTH_DEFAULT_LAYOUT',
        // TB3: the default layout's 0.8 frozen as 0.9 adds `words.note` (TB3-F).
        'EIGHTH_DEFAULT_LAYOUT',
        'SIXTH_DEFAULT_CATALOGUES',
        'SIXTH_DEFAULT_CATALOGUES_BY_VERSION',
        'SIXTH_DEFAULT_CATALOGUE_VERSIONS',
        'SIXTH_DEFAULT_THEME',
        'SIXTH_DEFAULT_THEME_VERSION',
      ].sort(),
    );
  });

  it('CNT-010 exposes one entry point that validates, and no way round it', () => {
    expect(typeof domain.parseContentDocument).toBe('function');
    expect(domain).not.toHaveProperty('unsafeParseContentDocument');
  });
});
