import type { AssetVersionContent } from '../assets/version.js';
import type { QueryDefinition } from '../data/definition.js';
import { equationAlternative } from '../content/admission/mathml.js';
import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { InlineNode } from '../content/model/inline.js';
import type { ComponentTypeDefinition } from '../metadata/component-type.js';
import type { DataType, FieldDefinition } from '../metadata/field.js';
import type { MetadataSchemaDefinition } from '../metadata/schema.js';
import { isUserValue, type MetadataValues } from '../metadata/values.js';
import type { OutlineDocument, OutlineNode } from '../structure/outline.js';
import type { StartingSection, TemplateDefinition } from '../template/definition.js';

/**
 * What search finds (search.md, "Searching words, in T1"; SCH-054): every kind the product holds, and
 * a document's section as a kind of its own, so the section that says a thing is what is found.
 */
export const searchKinds = [
  'component',
  'document',
  'section',
  'publication',
  'template',
  'asset',
  'field',
  'metadataSchema',
  'componentType',
  // A query definition, by its title, description and columns (SCH-055; the D2 plan, D2-S).
  'queryDefinition',
] as const;

export type SearchKind = (typeof searchKinds)[number];

/**
 * The text search configurations Postgres ships, by the primary subtag of the languages they stem, and
 * `simple` - which only folds case - for every other language and for text in none. A configuration is
 * named here only where the Postgres the product runs on has it, which the store's test checks.
 */
const configurationsBySubtag = {
  ar: 'arabic',
  ca: 'catalan',
  da: 'danish',
  de: 'german',
  el: 'greek',
  en: 'english',
  es: 'spanish',
  eu: 'basque',
  fi: 'finnish',
  fr: 'french',
  ga: 'irish',
  hi: 'hindi',
  hu: 'hungarian',
  hy: 'armenian',
  id: 'indonesian',
  it: 'italian',
  lt: 'lithuanian',
  nb: 'norwegian',
  ne: 'nepali',
  nl: 'dutch',
  nn: 'norwegian',
  no: 'norwegian',
  pt: 'portuguese',
  ro: 'romanian',
  ru: 'russian',
  sr: 'serbian',
  sv: 'swedish',
  ta: 'tamil',
  tr: 'turkish',
  yi: 'yiddish',
} as const;

export type SearchConfiguration =
  (typeof configurationsBySubtag)[keyof typeof configurationsBySubtag] | 'simple';

/** Every configuration an entry may be written in, `simple` among them. */
export const SEARCH_CONFIGURATIONS: readonly SearchConfiguration[] = [
  ...new Set([...Object.values(configurationsBySubtag), 'simple' as const]),
];

/** The configuration a language's text is folded by: its primary subtag's, or `simple`. */
export function configurationFor(language: string | null): SearchConfiguration {
  const subtag = language?.split('-')[0]?.toLowerCase() ?? '';
  return Object.hasOwn(configurationsBySubtag, subtag)
    ? configurationsBySubtag[subtag as keyof typeof configurationsBySubtag]
    : 'simple';
}

/**
 * One place in an entry and its words. A place is `title`; `block:<id>`, a block of a component - a
 * footnote's paragraph and a table cell's among them; `field:<id>`, a field's value; `section:<key>`, a
 * template's starting section; `description`, an asset's; `fields` and `schemas`, what a metadata
 * schema groups and a component type assigns, by name.
 */
export interface SearchText {
  readonly place: string;
  readonly text: string;
}

/** An entry as a version makes it, before the store adds who made it, where and when. */
export interface SearchEntryDraft {
  readonly kind: SearchKind;
  /** A section's outline node; null for everything else. */
  readonly node: string | null;
  readonly title: string;
  readonly configuration: SearchConfiguration;
  /** The values as stored - what a filter and a facet read - or none for a kind that holds none. */
  readonly values: MetadataValues;
  readonly texts: readonly SearchText[];
}

/** What a version is read from: its content, parsed, and for a publication what it published. */
export type SearchSource =
  | {
      readonly kind: 'component';
      readonly content: ContentDocument;
      readonly values: MetadataValues;
    }
  | {
      readonly kind: 'document';
      readonly content: OutlineDocument;
      readonly values: MetadataValues;
    }
  | {
      readonly kind: 'publication';
      /** Its document's title and language at the version it published, and that version's number. */
      readonly title: string;
      readonly language: string;
      readonly version: string;
    }
  | { readonly kind: 'template'; readonly content: TemplateDefinition }
  | { readonly kind: 'asset'; readonly content: AssetVersionContent }
  | { readonly kind: 'field'; readonly content: FieldDefinition }
  | { readonly kind: 'metadataSchema'; readonly content: MetadataSchemaDefinition }
  | { readonly kind: 'componentType'; readonly content: ComponentTypeDefinition }
  | { readonly kind: 'queryDefinition'; readonly content: QueryDefinition };

/** The names a version's words are rendered with, read by the store. */
export interface SearchContext {
  /** Each field by its artifact's id: its latest name, and its data type. */
  readonly fields: ReadonlyMap<string, { readonly name: string; readonly dataType: DataType }>;
  /** Each metadata schema's latest name, by its artifact's id. */
  readonly schemas: ReadonlyMap<string, string>;
  /** Each person's name, by their principal's id. */
  readonly people: ReadonlyMap<string, string>;
}

/** Composed (SCH-012), and every run of white space one space: words, not layout. */
const words = (text: string): string => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

/** The words of inline content, spoken as a reader hears it; a footnote's are a place of their own. */
function inlineWords(inlines: readonly InlineNode[] | undefined): string {
  let out = '';
  for (const inline of inlines ?? []) {
    if (inline.type === 'text') out += inline.value;
    else if (inline.type === 'equation') out += ` ${equationAlternative(inline.mathml) ?? ''} `;
    else if (inline.type === 'image' && inline.alternative.kind === 'own') {
      out += ` ${inline.alternative.text} `;
    }
  }
  return out;
}

/** The blocks a footnote in these inlines holds, which are places of their own. */
function footnoteBlocks(inlines: readonly InlineNode[] | undefined): BlockNode[] {
  return (inlines ?? []).flatMap((inline) =>
    inline.type === 'footnote' ? (inline.content as BlockNode[]) : [],
  );
}

/** A block's own words, as search reads them, with what kind of block it is. */
export interface BlockWords {
  readonly id: string;
  readonly kind: BlockNode['type'];
  /** Empty where it has none: a figure with no caption, an empty paragraph. */
  readonly text: string;
}

/**
 * Every block in order, each with only its own words; what a block holds follows it as blocks of their
 * own. Search's places, and what a comparison of two texts reads (the R1 plan's recovery dialog).
 */
export function wordsByBlock(blocks: readonly BlockNode[]): BlockWords[] {
  const out: BlockWords[] = [];
  const add = (block: BlockNode, parts: readonly string[]) => {
    out.push({ id: block.id, kind: block.type, text: words(parts.join(' ')) });
  };
  const walk = (block: BlockNode): void => {
    switch (block.type) {
      case 'paragraph':
        add(block, [inlineWords(block.content)]);
        footnoteBlocks(block.content).forEach(walk);
        return;
      case 'list':
        add(
          block,
          block.items.map((item) => inlineWords(item.term)),
        );
        for (const item of block.items) {
          footnoteBlocks(item.term).forEach(walk);
          item.content.forEach(walk);
        }
        return;
      case 'table':
        add(block, [inlineWords(block.caption), inlineWords(block.note)]);
        footnoteBlocks(block.caption).forEach(walk);
        footnoteBlocks(block.note).forEach(walk);
        for (const row of block.rows) for (const cell of row.cells) cell.content.forEach(walk);
        return;
      case 'boundTable':
        // Its own words (the TB1 plan, TB1-D): caption, headers, empty statement, note and source.
        // Its cells are a result's values, which a component never holds.
        add(block, [
          inlineWords(block.caption),
          ...block.columns.map((column) => column.header),
          inlineWords(block.empty),
          inlineWords(block.note),
          inlineWords(block.source),
        ]);
        footnoteBlocks(block.caption).forEach(walk);
        footnoteBlocks(block.note).forEach(walk);
        footnoteBlocks(block.source).forEach(walk);
        return;
      case 'figure':
        add(block, [
          inlineWords(block.caption),
          block.alternative.kind === 'own' ? block.alternative.text : '',
        ]);
        footnoteBlocks(block.caption).forEach(walk);
        return;
      case 'preformatted':
        add(block, [block.text]);
        return;
      case 'blockquote':
        add(block, [inlineWords(block.attribution)]);
        footnoteBlocks(block.attribution).forEach(walk);
        block.content.forEach(walk);
        return;
      case 'equation':
        add(block, [equationAlternative(block.mathml) ?? '']);
        return;
    }
  };
  blocks.forEach(walk);
  return out;
}

/** One row per block that has words of its own (SCH-016), keyed by its place. */
function blockTexts(blocks: readonly BlockNode[]): SearchText[] {
  return wordsByBlock(blocks)
    .filter((each) => each.text !== '')
    .map((each) => ({ place: `block:${each.id}`, text: each.text }));
}

/**
 * A value in words, by its field's data type: a person by name, a boolean by its field's name where it
 * is true and by nothing where it is not, anything else as written. A field the store no longer knows
 * is read as written where it is text, and otherwise says nothing.
 */
function valueWords(
  value: unknown,
  field: { name: string; dataType: DataType } | undefined,
): string {
  if (Array.isArray(value)) return value.map((each) => valueWords(each, field)).join(' ');
  if (field?.dataType === 'boolean') return value === true ? field.name : '';
  if (isUserValue(value)) return '';
  return typeof value === 'string' ? value : '';
}

function valueTexts(values: MetadataValues, context: SearchContext): SearchText[] {
  return Object.entries(values).flatMap(([id, value]) => {
    const field = context.fields.get(id);
    const said =
      field?.dataType === 'user'
        ? [value]
            .flat()
            .map((each) => (isUserValue(each) ? (context.people.get(each.user) ?? '') : ''))
            .join(' ')
        : valueWords(value, field);
    const text = words(said);
    return text === '' ? [] : [{ place: `field:${id}`, text }];
  });
}

const titled = (title: string, rest: readonly SearchText[]): SearchText[] => {
  const text = words(title);
  return [...(text === '' ? [] : [{ place: 'title', text }]), ...rest];
};

/** A section and every section below it, each an entry, whatever kind of node stands between. */
function sectionEntries(
  nodes: readonly OutlineNode[],
  configuration: SearchConfiguration,
  context: SearchContext,
): SearchEntryDraft[] {
  return nodes.flatMap((node) => {
    const below = sectionEntries(node.children, configuration, context);
    if (node.type !== 'section') return below;
    const title = words(inlineWords(node.title));
    return [
      {
        kind: 'section' as const,
        node: node.id,
        title,
        configuration,
        values: node.values,
        texts: titled(title, valueTexts(node.values, context)),
      },
      ...below,
    ];
  });
}

function startingSectionTexts(sections: readonly StartingSection[]): SearchText[] {
  return sections.flatMap((section) => {
    const text = words(inlineWords(section.title));
    return [
      ...(text === '' ? [] : [{ place: `section:${section.key}`, text }]),
      ...startingSectionTexts(section.children),
    ];
  });
}

const named = (names: readonly (string | undefined)[]) =>
  words(names.filter((name) => name !== undefined).join(' '));

/**
 * The entries a version makes, and each entry's words place by place (search.md, "What is an entry";
 * SCH-002): a component's title, blocks and values; a document's title and values, and each of its
 * sections as an entry of its own; a publication by its document's title and its version; a template
 * by its name and its starting sections; an asset by its description; a definition by its name, and
 * what it groups or assigns by theirs; a query definition by its title, its description and its
 * columns' names - never its SQL, which would put every author's SQL in every reader's results, and
 * never its connection's name, which a reader of the definition may not be allowed to read (D2-S).
 */
export function entriesOf(source: SearchSource, context: SearchContext): SearchEntryDraft[] {
  const entry = (
    title: string,
    configuration: SearchConfiguration,
    texts: readonly SearchText[],
    values: MetadataValues = {},
  ): SearchEntryDraft => ({
    kind: source.kind,
    node: null,
    title: words(title),
    configuration,
    values,
    texts,
  });
  switch (source.kind) {
    case 'component': {
      const { content, values } = source;
      return [
        entry(
          content.title,
          configurationFor(content.language),
          titled(content.title, [...blockTexts(content.content), ...valueTexts(values, context)]),
          values,
        ),
      ];
    }
    case 'document': {
      const { content, values } = source;
      const configuration = configurationFor(content.language);
      return [
        entry(
          content.title,
          configuration,
          titled(content.title, valueTexts(values, context)),
          values,
        ),
        ...sectionEntries(content.nodes, configuration, context),
      ];
    }
    case 'publication':
      return [
        entry(
          source.title,
          configurationFor(source.language),
          titled(`${source.title} ${source.version}`, []),
        ),
      ];
    case 'template':
      return [
        entry(
          source.content.name,
          'simple',
          titled(source.content.name, startingSectionTexts(source.content.outline.sections)),
        ),
      ];
    case 'asset': {
      const description = source.content.alternative;
      const text = words(description?.text ?? '');
      return [
        entry(
          text,
          configurationFor(description?.language ?? null),
          text === '' ? [] : [{ place: 'description', text }],
        ),
      ];
    }
    case 'field':
      return [entry(source.content.name, 'simple', titled(source.content.name, []))];
    case 'metadataSchema': {
      const fields = named(
        source.content.entries.map((each) => context.fields.get(each.field)?.name),
      );
      return [
        entry(
          source.content.name,
          'simple',
          titled(source.content.name, fields === '' ? [] : [{ place: 'fields', text: fields }]),
        ),
      ];
    }
    case 'queryDefinition': {
      const { content } = source;
      const texts: SearchText[] = [];
      const add = (place: string, said: string) => {
        const text = words(said);
        if (text !== '') texts.push({ place, text });
      };
      add('description', content.description);
      add('columns', content.columns.map((column) => column.name).join(' '));
      return [entry(content.title, 'simple', titled(content.title, texts))];
    }
    case 'componentType': {
      const schemas = named(
        source.content.assignments.map((each) => context.schemas.get(each.schema)),
      );
      return [
        entry(
          source.content.name,
          'simple',
          titled(source.content.name, schemas === '' ? [] : [{ place: 'schemas', text: schemas }]),
        ),
      ];
    }
  }
}
