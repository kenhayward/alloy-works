import { randomUUID } from 'node:crypto';
import {
  defaultNumberingScheme,
  DEFINITION_SCHEMA_VERSION,
  OUTLINE_SCHEMA_VERSION,
  TEMPLATE_SCHEMA_VERSION,
  type SearchKind,
} from '@alloy-works/domain';
import { createComponent } from '../creation.js';
import { DEFAULT_LAYOUT_ID } from '../layouts.js';
import { recordPublication, requestPublication } from '../publishing.js';
import type { TenantTransaction } from '../tables.js';
import { DEFAULT_THEME_ID } from '../themes.js';
import { createArtifact } from '../versions.js';

const text = (value: string) => [{ type: 'text', value, marks: [] }];

/** A section node identifier, 26 of the outline's letters, made fresh for each document. */
const nodeId = () =>
  Array.from(
    { length: 26 },
    () => 'abcdefghijklmnopqrstuvwxyz234567'[Math.floor(Math.random() * 32)],
  ).join('');

/**
 * One of every kind search finds, each holding `word` - for a test that must reach every kind, as the
 * leak suite does (SCH-010). The document's one section holds the word too, and so does the
 * publication, by its document's title. Answers each kind's artifact, and the section's node.
 */
export async function everyKind(
  trx: TenantTransaction,
  input: {
    readonly author: string;
    readonly spaceId: string;
    readonly word: string;
    /** The tenant's role, which an object key names. */
    readonly role: string;
  },
): Promise<Readonly<Record<SearchKind, string>> & { readonly node: string }> {
  const { author, spaceId, word } = input;
  const component = await createComponent(trx, {
    spaceId,
    title: `${word} component`,
    language: 'en-GB',
    direction: 'ltr',
    author,
  });
  if (component.answer !== 'created') throw new Error(component.answer);
  const node = nodeId();
  const document = await createArtifact(trx, {
    author,
    spaceId,
    substance: {
      kind: 'document',
      content: {
        schemaVersion: OUTLINE_SCHEMA_VERSION,
        title: `${word} document`,
        language: 'en-GB',
        direction: 'ltr',
        nodes: [
          {
            type: 'section',
            id: node,
            title: text(`${word} section`),
            numbered: true,
            matter: 'body',
            pageBreak: 'none',
            values: {},
            children: [],
          },
        ],
      },
    } as never,
  });
  const template = await createArtifact(trx, {
    author,
    spaceId,
    substance: {
      kind: 'template',
      content: {
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
        name: `${word} template`,
        theme: DEFAULT_THEME_ID,
        layout: DEFAULT_LAYOUT_ID,
        schemas: [],
        outline: { sections: [] },
        changes: { add: true, remove: true, reorder: true },
      },
    } as never,
  });
  const asset = await createArtifact(trx, {
    author,
    spaceId,
    substance: {
      kind: 'asset',
      content: {
        schemaVersion: 1,
        object: `${input.role}/sha256/${'d'.repeat(64)}`,
        format: 'png',
        bytes: 10,
        width: 1,
        height: 1,
        orientation: 1,
        colour: 'rgb',
        alpha: false,
        depth: 8,
        resolution: null,
        alternative: { text: `A ${word} asset`, language: 'en' },
      },
    },
  });
  const identity = (name: string) => ({
    schemaVersion: DEFINITION_SCHEMA_VERSION as typeof DEFINITION_SCHEMA_VERSION,
    id: randomUUID(),
    name,
  });
  const field = await createArtifact(trx, {
    author,
    substance: {
      kind: 'field',
      content: {
        ...identity(`${word} field`),
        dataType: 'text',
        multiplicity: 'one',
        validation: {},
      },
    },
  });
  const metadataSchema = await createArtifact(trx, {
    author,
    substance: { kind: 'metadataSchema', content: { ...identity(`${word} schema`), entries: [] } },
  });
  const componentType = await createArtifact(trx, {
    author,
    substance: {
      kind: 'componentType',
      content: { ...identity(`${word} type`), assignments: [] },
    },
  });
  const asked = await requestPublication(trx, {
    documentId: document.artifactId,
    version: document.id,
    formats: ['pdf'],
    requester: author,
  });
  if (asked.answer !== 'requested') throw new Error(asked.answer);
  const publication = await recordPublication(trx, {
    requestId: asked.request.id,
    pipelineVersion: '5',
    fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
    dataSha256: 'b'.repeat(64),
    numbering: { scheme: defaultNumberingScheme.id, entries: [] },
    outputs: [
      {
        format: 'pdf' as const,
        engineVersion: '0.15.1',
        templateVersion: 5,
        key: `${input.role}/sha256/${'c'.repeat(64)}`,
        sha256: 'c'.repeat(64),
        bytes: 1000,
      },
    ],
  });
  if (!publication) throw new Error('Expected a publication');
  return {
    component: component.version.artifactId,
    document: document.artifactId,
    section: document.artifactId,
    node,
    publication,
    template: template.artifactId,
    asset: asset.artifactId,
    field: field.artifactId,
    metadataSchema: metadataSchema.artifactId,
    componentType: componentType.artifactId,
  };
}
