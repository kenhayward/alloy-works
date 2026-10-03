import { randomUUID } from 'node:crypto';
import {
  CONNECTION_SCHEMA_VERSION,
  QUERY_DEFINITION_SCHEMA_VERSION,
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
import { recordDatasetVersion } from '../datasets.js';
import { createArtifact } from '../versions.js';

const text = (value: string) => [{ type: 'text', value, marks: [] }];

/** A section node identifier, 26 of the outline's letters, made fresh for each document. */
const nodeId = () =>
  Array.from(
    { length: 26 },
    () => 'abcdefghijklmnopqrstuvwxyz234567'[Math.floor(Math.random() * 32)],
  ).join('');

/** Publishes this document version as a PDF, as the worker would record it, answering the publication. */
export async function publish(
  trx: TenantTransaction,
  input: {
    readonly document: { readonly artifactId: string; readonly id: string };
    readonly author: string;
    readonly role: string;
  },
): Promise<string> {
  const asked = await requestPublication(trx, {
    documentId: input.document.artifactId,
    version: input.document.id,
    formats: ['pdf'],
    requester: input.author,
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
  return publication;
}

/**
 * One of every kind search finds, each holding `word` - for a test that must reach every kind, as the
 * leak suite does (SCH-010). The document's one section holds the word too, and so does the
 * publication, by its document's title; the query definition names a connection it makes. Answers each
 * kind's artifact, and the section's node. `before0046` leaves the query definition and its connection
 * out, for a tenant migrated only as far as a test of an earlier migration needs, and `before0047` the
 * dataset, which records one result of the query definition as a service account's run.
 */
export async function everyKind(
  trx: TenantTransaction,
  input: {
    readonly author: string;
    readonly spaceId: string;
    readonly word: string;
    /** The tenant's role, which an object key names. */
    readonly role: string;
    readonly before0046?: boolean;
    readonly before0047?: boolean;
  },
): Promise<
  Readonly<Record<Exclude<SearchKind, 'queryDefinition'>, string>> & {
    readonly queryDefinition?: string;
    readonly dataset?: string;
    readonly node: string;
  }
> {
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
  const publication = await publish(trx, { document, author, role: input.role });
  let queryDefinition: string | undefined;
  let dataset: string | undefined;
  if (!input.before0046) {
    // A query definition names a connection, which is in no search of its own.
    const connection = await createArtifact(trx, {
      author,
      spaceId,
      substance: {
        kind: 'connection',
        content: {
          schemaVersion: CONNECTION_SCHEMA_VERSION,
          name: `${word} connection`,
          description: '',
          type: 'postgres',
          source: {
            host: 'source-postgres',
            port: 5432,
            database: 'readings',
            account: 'reader',
            tls: 'require',
          },
          identity: { kind: 'service' },
          retired: false,
        },
      },
    });
    const defined = await createArtifact(trx, {
      author,
      spaceId,
      substance: {
        kind: 'queryDefinition',
        content: {
          schemaVersion: QUERY_DEFINITION_SCHEMA_VERSION,
          title: `${word} query definition`,
          description: '',
          connection: connection.artifactId,
          parameters: [],
          fetch: { kind: 'sql', text: 'select id from sample.site order by id' },
          columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'integer' } }],
          key: ['id'],
          order: [{ column: 'id', direction: 'ascending' }],
          empty: 'valid',
          limits: { rows: 100, bytes: 100_000, seconds: 10 },
          retired: false,
        },
      },
    });
    queryDefinition = defined.artifactId;
    if (!input.before0047) {
      // A dataset is in no search either; it is here so a test reaching every kind reaches it.
      dataset = (
        await recordDatasetVersion(trx, {
          author,
          provenance: {
            schemaVersion: 1,
            queryDefinition: { artifact: defined.artifactId, version: defined.id },
            connection: { artifact: connection.artifactId, version: connection.id },
            parameters: {},
            ran: { sql: 'select id from sample.site order by id' },
            identity: { kind: 'service' },
            at: '2026-10-03T09:00:00.000Z',
            durationMs: 1,
            rowCount: 0,
            columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'integer' } }],
            canonical: 1,
            checksum: 'e'.repeat(64),
            images: {},
          },
        })
      ).dataset.id;
    }
  }
  return {
    ...(queryDefinition === undefined ? {} : { queryDefinition }),
    ...(dataset === undefined ? {} : { dataset }),
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
