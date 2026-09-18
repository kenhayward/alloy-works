import { randomBytes } from 'node:crypto';
import {
  blockIdentifierFrom,
  conditions,
  defaultNumberingScheme,
  number,
  resolve,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
  type ReferenceNode,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { numberingInputs, readablePinnedVersions } from './numbering.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';
const nodeId = () => blockIdentifierFrom(randomBytes(16));

/** A component's content: three figures, the second inside a list. */
const figured = (title: string): ContentDocument => {
  const figure = (id: string) => ({
    type: 'figure' as const,
    id,
    asset: 'asset',
    imageStyle: 'wide',
    caption: 'A caption',
    alternative: { kind: 'decorative' as const },
  });
  return {
    schemaVersion: 1,
    title,
    language: 'en-GB',
    direction: 'ltr',
    content: [
      figure('f1'),
      { type: 'list', id: 'l1', kind: 'unordered', items: [{ content: [figure('f2')] }] },
      figure('f3'),
    ],
  };
};

const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };

const sectionNode = (title: string, children: OutlineNode[]): OutlineNode => ({
  type: 'section',
  id: nodeId(),
  title: [{ type: 'text', value: title, marks: [] }],
  ...base,
  children,
});

const referenceNode = (component: string, mode: ReferenceNode['mode']): ReferenceNode => ({
  type: 'reference',
  id: nodeId(),
  component,
  mode,
  ...base,
  children: [],
});

describe('what a document numbers against, read from the store', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const generalOf = (trx: TenantTransaction) =>
    trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  /** A component at 0.1, as created, and at 0.2, holding three figures. */
  const component = async (
    trx: TenantTransaction,
    space: string,
    author: string,
    title: string,
  ): Promise<{ first: StoredVersion; head: StoredVersion }> => {
    const made = await createComponent(trx, {
      spaceId: space,
      title,
      language: 'en-GB',
      direction: 'ltr',
      author,
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    const substance = substanceOf(made.version);
    if (substance.kind !== 'component') throw new Error('not a component');
    const recorded = await recordVersion(trx, {
      artifactId: made.version.artifactId,
      openedFrom: made.version.id,
      author,
      substance: { ...substance, content: figured(title) },
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return { first: made.version, head: recorded.version };
  };

  /** A document whose outline is recorded as given: the store's checks on a reference are bypassed. */
  const documentWith = async (trx: TenantTransaction, nodes: OutlineNode[]) => {
    const made = await createDocument(trx, {
      spaceId: general,
      title: 'The dosing report',
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
    return outline;
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      grace = await person(trx, 'grace', 'Grace');
      general = await generalOf(trx);
      quality = (await createSpace(trx, 'Quality')).id;
      const author = await findRole(trx, 'Author');
      // Ada may read General; Grace may read General and Quality.
      for (const [principal, space] of [
        [ada, general],
        [grace, general],
        [grace, quality],
      ] as const) {
        await grant(trx, {
          roleId: author!.id,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('resolves each occurrence, reads nothing the reader may not read, and withholds what it could move', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');
      const first = referenceNode(shared.head.artifactId, { kind: 'latest' });
      const pinned = referenceNode(shared.head.artifactId, {
        kind: 'pinned',
        version: shared.first.id,
      });
      const hidden = referenceNode(secret.head.artifactId, { kind: 'latest' });
      const later = referenceNode(shared.head.artifactId, { kind: 'latest' });
      const waiting = referenceNode(shared.head.artifactId, { kind: 'approved' });
      const outline = await documentWith(trx, [
        sectionNode('Introduction', [first, pinned, hidden, later]),
        sectionNode('Method', [waiting]),
      ]);

      const forAda = await numberingInputs(trx, outline, ada);
      expect(forAda.occurrences).toEqual([
        { node: first.id, version: shared.head.id },
        { node: pinned.id, version: shared.first.id },
        { node: hidden.id, version: null },
        { node: later.id, version: shared.head.id },
        // `approved` resolves to nothing yet, though the same component's head was read above.
        { node: waiting.id, version: null },
      ]);
      expect([...forAda.contributions.keys()]).toEqual([first.id, pinned.id, later.id]);
      // Version 0.1 is one empty paragraph: known, and contributing nothing.
      expect(forAda.contributions.get(pinned.id)).toEqual([]);

      const figuresFor = async (principal: string, node: string) => {
        const inputs = await numberingInputs(trx, outline, principal);
        const table = number(
          conditions(resolve(outline, inputs.contributions)),
          defaultNumberingScheme,
        );
        return table.entries
          .filter((entry) => entry.node === node && entry.sequence === 'figure')
          .map((entry) => entry.label);
      };
      expect(await figuresFor(ada, first.id)).toEqual(['Figure 1.1', 'Figure 1.2', 'Figure 1.3']);
      // After the component Ada may not read, in the same chapter: withheld, not guessed.
      expect(await figuresFor(ada, later.id)).toEqual([null, null, null]);
      // Grace may read it, so she is told the numbers Ada is not.
      expect(await figuresFor(grace, later.id)).toEqual(['Figure 1.7', 'Figure 1.8', 'Figure 1.9']);
    });
  });

  it('never reads a pinned version that is not the component the node names', async () => {
    await service.withTenant(production, async (trx) => {
      const one = await component(trx, general, ada, 'One');
      // F7: crossed to a component Ada may not read at all (Grace's, in Quality) - the pins query
      // must never select its row, not merely discard it once the artifact ids are compared.
      const other = await component(trx, quality, grace, 'Other');
      // The operation refuses this at the write; recorded directly, the read must refuse it too.
      const crossed = referenceNode(one.head.artifactId, {
        kind: 'pinned',
        version: other.head.id,
      });
      const outline = await documentWith(trx, [crossed]);
      const inputs = await numberingInputs(trx, outline, ada);
      expect(inputs.occurrences).toEqual([{ node: crossed.id, version: null }]);
      expect(inputs.contributions.size).toBe(0);
    });
  });

  it("never reads another environment's component, whatever an outline names", async () => {
    const theirs = await service.withTenant(development, async (trx) => {
      const ivy = await person(trx, 'ivy', 'Ivy');
      return component(trx, await generalOf(trx), ivy, 'Elsewhere');
    });
    await service.withTenant(production, async (trx) => {
      const foreign = referenceNode(theirs.head.artifactId, { kind: 'latest' });
      const pinnedForeign = referenceNode(theirs.head.artifactId, {
        kind: 'pinned',
        version: theirs.head.id,
      });
      const outline = await documentWith(trx, [foreign, pinnedForeign]);
      const inputs = await numberingInputs(trx, outline, ada);
      expect(inputs.occurrences).toEqual([
        { node: foreign.id, version: null },
        { node: pinnedForeign.id, version: null },
      ]);
      expect(inputs.contributions.size).toBe(0);
    });
  });

  it('the pinned-rows query never selects a version outside the readable set (F7)', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');
      const secret = await component(trx, quality, grace, 'Calibration');

      // Proved directly against the query, not only against what `numberingInputs` returns: an
      // unreadable component's row is never selected - not "selected, then the caller discards it".
      const rows = await readablePinnedVersions(
        trx,
        [shared.head.id, secret.head.id],
        new Set([shared.head.artifactId]),
      );
      expect(rows.map((row) => row.id)).toEqual([shared.head.id]);
    });
  });

  it('a `latest` reference picks up a new head with no cache (decision B)', async () => {
    await service.withTenant(production, async (trx) => {
      const shared = await component(trx, general, ada, 'Install the printer');

      // Number once, record a new version, number again in the same transaction: the second answer
      // moves to the new version, the first is untouched.
      const placement = referenceNode(shared.head.artifactId, { kind: 'latest' });
      const outline = await documentWith(trx, [placement]);
      const before = await numberingInputs(trx, outline, ada);
      expect(before.occurrences).toEqual([{ node: placement.id, version: shared.head.id }]);
      expect(before.contributions.get(placement.id)).toHaveLength(3);

      const substance = substanceOf(shared.head);
      if (substance.kind !== 'component') throw new Error('not a component');
      const grown = figured('Install the printer');
      const fourth = {
        type: 'figure' as const,
        id: 'f4',
        asset: 'asset',
        imageStyle: 'wide' as const,
        caption: 'A caption',
        alternative: { kind: 'decorative' as const },
      };
      const revised = await recordVersion(trx, {
        artifactId: shared.head.artifactId,
        openedFrom: shared.head.id,
        author: ada,
        substance: {
          ...substance,
          content: { ...grown, content: [...grown.content, fourth] },
        },
      });
      if (revised.answer !== 'recorded') throw new Error(revised.answer);

      const after = await numberingInputs(trx, outline, ada);
      expect(after.occurrences).toEqual([{ node: placement.id, version: revised.version.id }]);
      expect(after.contributions.get(placement.id)).toHaveLength(4);
    });
  });
});
