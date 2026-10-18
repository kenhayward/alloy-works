import { randomBytes } from 'node:crypto';
import {
  createArtifact,
  createComponent,
  createDocument,
  findRole,
  grant,
  recordVersion,
  substanceOf,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  blockIdentifierFrom,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
  withAlternative,
} from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import sharp from 'sharp';

/**
 * The reference document the publishing and preview budgets are measured on (PUB-102, CNT-151), and
 * its seeding through the store, not the editor: what is measured is publishing or previewing a
 * document this size, not building one.
 */

/**
 * **The declared reference document** (PUB-102): 30 chapters, each placing one component of 100
 * blocks, in a cycle of twenty - a figure, a table of a header row and four rows of three cells, a
 * numbered equation displayed on its own and a paragraph with a footnote, each once, and sixteen
 * paragraphs of prose of about 300 characters. So 3,000 blocks: 150 figures, 150 tables, 150
 * equations, 150 footnotes and 2,400 paragraphs of prose besides, set to about 300 pages under the
 * default layout and theme, measured by the page count below.
 */
export const CHAPTERS = 30;
export const BLOCKS_PER_COMPONENT = 100;
/**
 * Measured at 311 pages under Typst 0.15.1 and the default theme's first version. The range lets the
 * engine or the theme move it a little, and fails a change that makes it another document.
 */
export const PAGES = { least: 270, most: 330 } as const;
/** An equation in the one form the MathML reader writes, with the words it is spoken by. */
const MATHML = withAlternative(
  '<math xmlns="http://www.w3.org/1998/Math/MathML">' +
    '<mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow></math>',
  'E equals m c squared',
);
const PROSE =
  'Set the tray level before each run, check the reading against the reference weight, and write ' +
  'down what the gauge says. Ada and Grace agreed that a reading off by more than a tenth is taken ' +
  'again, and that the press is not started until two readings in a row agree with each other.';

const nodeId = () => blockIdentifierFrom(randomBytes(16));
const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
const paragraph = (id: string, ...content: unknown[]) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
const cell = (id: string, value: string) => ({
  content: [paragraph(id, text(value))],
  colspan: 1,
  rowspan: 1,
});

/** The block at `index` of a component, by its place in the cycle of twenty. */
export const block = (index: number, image: string) => {
  const id = `b${index}`;
  switch (index % 20) {
    case 0:
      return {
        type: 'figure',
        id,
        asset: image,
        imageStyle: 'figure',
        caption: [text(`The tray at step ${index}`)],
        alternative: { kind: 'inherited' },
      };
    case 5:
      return {
        type: 'table',
        id,
        style: 'table',
        caption: [text(`Readings at step ${index}`)],
        headerRows: 1,
        headerColumns: 0,
        rows: ['Site', 'North', 'South', 'East', 'West'].map((site, row) => ({
          cells: ['Morning', 'Noon', 'Evening'].map((time, column) =>
            cell(`${id}r${row}c${column}`, row === 0 ? time : `${site} ${row * 3 + column}.5`),
          ),
        })),
      };
    case 10:
      return { type: 'equation', id, mathml: MATHML, numbered: true };
    case 15:
      return paragraph(id, text(PROSE), {
        type: 'footnote',
        id: `${id}n`,
        anchor: { kind: 'span' },
        content: [paragraph(`${id}p`, text('Grace takes the second reading.'))],
      });
    default:
      return paragraph(id, text(PROSE));
  }
};

/** The reference document seeded, and Ada, who may author and publish in General, and its parts. */
export interface ReferenceDocument {
  readonly ada: string;
  readonly document: { readonly id: string; readonly version: string };
  /** Each chapter's reference node and the component it places, with that component's version. */
  readonly chapters: readonly {
    readonly node: string;
    readonly component: string;
    readonly version: string;
    readonly content: ContentDocument;
  }[];
  /** The server's version, for the configuration a budget is recorded beside. */
  readonly postgres: string;
}

export async function seedReferenceDocument(
  service: TenantDatabase,
  tenant: Tenant,
  stores: ObjectStores,
): Promise<ReferenceDocument> {
  const configuration = { postgres: '' };
  let ada = '';
  const chapters: {
    node: string;
    component: string;
    version: string;
    content: ContentDocument;
  }[] = [];
  const image = await sharp({
    create: { width: 800, height: 400, channels: 3, background: { r: 40, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();
  // Seeded through the store, not through the editor: what is measured is publishing a document
  // this size, not building one.
  const document = await service.withTenant(tenant, async (trx: TenantTransaction) => {
    configuration.postgres = (
      await trx
        .selectNoFrom((eb) => eb.fn<string>('current_setting', [eb.val('server_version')]).as('v'))
        .executeTakeFirstOrThrow()
    ).v;
    ada = (
      await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'ada',
          email: null,
          display_name: 'Ada',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const general = (
      await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow()
    ).id;
    for (const role of ['Author', 'Publisher']) {
      const found = await findRole(trx, role);
      await grant(trx, {
        roleId: found!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
    }
    const kept = await (await stores.forTenant(trx, tenant)).put(image, 'image/png');
    const asset = await createArtifact(trx, {
      spaceId: general,
      author: ada,
      substance: {
        kind: 'asset',
        content: {
          schemaVersion: 1,
          object: kept.key,
          format: 'png',
          bytes: image.length,
          width: 800,
          height: 400,
          orientation: 1,
          colour: 'rgb',
          alpha: false,
          depth: 8,
          resolution: null,
          alternative: { text: 'A blue tray', language: 'en-GB' },
        },
      },
    });
    const base = {
      numbered: true,
      matter: 'body' as const,
      pageBreak: 'none' as const,
      values: {},
    };
    const nodes: OutlineNode[] = [];
    for (let chapter = 1; chapter <= CHAPTERS; chapter += 1) {
      const title = `Procedure ${chapter}`;
      const made = await createComponent(trx, {
        spaceId: general,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const substance = substanceOf(made.version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const content = {
        schemaVersion: 1,
        title,
        language: 'en-GB',
        direction: 'ltr',
        content: Array.from({ length: BLOCKS_PER_COMPONENT }, (_, at) => block(at, asset.id)),
      } as unknown as ContentDocument;
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: { ...substance, content },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      const reference = nodeId();
      chapters.push({
        node: reference,
        component: made.version.artifactId,
        version: recorded.version.id,
        content,
      });
      nodes.push({
        type: 'section',
        id: nodeId(),
        title: [text(`Chapter ${chapter}`)],
        ...base,
        children: [
          {
            type: 'reference',
            id: reference,
            component: made.version.artifactId,
            mode: { kind: 'latest' },
            ...base,
            children: [],
          },
        ],
      });
    }
    const made = await createDocument(trx, {
      spaceId: general,
      title: 'The reference manual',
      language: 'en-GB',
      direction: 'ltr',
      author: ada,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    const outline: OutlineDocument = { ...(made.version.content as OutlineDocument), nodes };
    const recorded = await recordVersion(trx, {
      artifactId: made.version.artifactId,
      openedFrom: made.version.id,
      author: ada,
      substance: { kind: 'document', content: outline },
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return { id: made.version.artifactId, version: recorded.version.id };
  });
  return { ada, document, chapters, postgres: configuration.postgres };
}
