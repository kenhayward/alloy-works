import { type OutlineDocument } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { archiveArtifact } from './archival.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { deleteArtifact } from './deletion.js';
import { setDocumentLanguage, type LanguageSkips } from './document-language.js';
import { createDocument, editOutline } from './documents.js';
import { claimLock } from './editing.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { beginTranslation } from './translation.js';
import { latestVersion, recordVersion, substanceOf, type StoredVersion } from './versions.js';
import { moveArtifact } from './workflow.js';
import { decideGate } from './workflow-gates.js';

const NONE: LanguageSkips = {
  notPermitted: 0,
  locked: 0,
  pinnedBehind: 0,
  translated: 0,
  missing: 0,
};

describe("changing a document's language", () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let general = '';

  const work = <T>(fn: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, fn);

  const component = (author = ada) =>
    work(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const blank = () =>
    work(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: general,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  /** The document with these references in it, each pinned at the version named or following latest. */
  const placing = async (...placed: readonly (StoredVersion | string)[]) => {
    let opened = await blank();
    for (const each of placed) {
      opened = await work(async (trx) => {
        const answer = await editOutline(trx, {
          artifactId: opened.artifactId,
          openedFrom: opened.id,
          author: ada,
          operation: {
            operation: 'insert',
            parent: null,
            position: 0,
            node:
              typeof each === 'string'
                ? { type: 'reference', component: each, mode: { kind: 'latest' } }
                : {
                    type: 'reference',
                    component: each.artifactId,
                    mode: { kind: 'pinned', version: each.id },
                  },
          } as never,
        });
        if (answer.answer !== 'recorded') throw new Error(JSON.stringify(answer));
        return answer.version;
      });
    }
    return opened;
  };

  const change = (opened: StoredVersion, language: string, components = true, author = ada) =>
    work((trx) =>
      setDocumentLanguage(trx, {
        artifactId: opened.artifactId,
        openedFrom: opened.id,
        author,
        scopes: undefined,
        language,
        components,
      }),
    );

  const latest = (id: string) => work(async (trx) => (await latestVersion(trx, id))!);
  const spoken = async (id: string) => {
    const { language, direction } = (await latest(id)).content as OutlineDocument;
    return `${language} ${direction}`;
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await work(async (trx) => {
      const person = async (subject: string) =>
        (
          await trx
            .insertInto('principal')
            .values({ issuer: 'https://idp.example', subject, email: `${subject}@example.com` })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('ada');
      grace = await person('grace');
      general = (await trx.selectFrom('space').select('id').executeTakeFirstOrThrow()).id;
      const author = await findRole(trx, 'Author');
      await grant(trx, {
        subject: { principal: ada },
        roleId: author!.id,
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('changes the document alone where its components are not asked for', async () => {
    const placed = await component();
    const opened = await placing(placed);
    const answer = await change(opened, 'fr-FR', false);
    expect(answer).toMatchObject({ answer: 'changed', changed: [], skipped: NONE });
    expect(await spoken(opened.artifactId)).toBe('fr-FR ltr');
    expect(await spoken(placed.artifactId)).toBe('en-GB ltr');
  });

  it('takes the direction of a declared language with it', async () => {
    const opened = await placing();
    await change(opened, 'ar');
    expect(await spoken(opened.artifactId)).toBe('ar rtl');
  });

  it('changes each component once, moves a pin at its latest, and declares no retranslation', async () => {
    const pinned = await component();
    const following = await component();
    const opened = await placing(pinned, following.artifactId, pinned);

    const answer = await change(opened, 'fr-FR');
    expect(answer).toMatchObject({
      answer: 'changed',
      changed: expect.arrayContaining([pinned.artifactId, following.artifactId]),
      skipped: NONE,
    });

    expect(await spoken(pinned.artifactId)).toBe('fr-FR ltr');
    expect(await spoken(following.artifactId)).toBe('fr-FR ltr');
    const moved = await latest(pinned.artifactId);
    const outline = (await latest(opened.artifactId)).content as OutlineDocument;
    const pins = outline.nodes.flatMap((node) =>
      node.type === 'reference' && node.mode.kind === 'pinned' ? [node.mode.version] : [],
    );
    expect(pins).toEqual([moved.id, moved.id]);
    expect(outline.language).toBe('fr-FR');

    const declared = await work((trx) =>
      trx
        .selectFrom('source_change')
        .select('retranslate')
        .where('version_id', '=', moved.id)
        .execute(),
    );
    expect(declared).toEqual([{ retranslate: false }]);
    const repointed = await work(async (trx) => {
      const { rows } = await sql<{ n: string }>`
        select count(*) as n from audit_event where kind = 'reference.repointed'
          and subject = ${opened.artifactId}`.execute(trx);
      return Number(rows[0]!.n);
    });
    expect(repointed).toBe(2);
  });

  it('leaves alone a component already in the language, counting it nowhere', async () => {
    const placed = await component();
    const opened = await placing(placed);
    const answer = await change(opened, 'en-GB');
    expect(answer).toMatchObject({ answer: 'unchanged', changed: [], skipped: NONE });
    expect((await latest(placed.artifactId)).id).toBe(placed.id);
  });

  it('skips and counts what it may not change, and changes the rest', async () => {
    const free = await component();
    const others = await component(grace);
    const held = await component();
    const behind = await component();
    await work(async (trx) => {
      const answer = await recordVersion(trx, {
        artifactId: behind.artifactId,
        openedFrom: behind.id,
        author: ada,
        substance: {
          ...substanceOf(behind),
          content: { ...(behind.content as object), title: 'A later title' },
        } as never,
      });
      if (answer.answer !== 'recorded') throw new Error(answer.answer);
    });
    const translated = await component();
    const gone = await component();
    const placed = await placing(free, others, held, behind, translated);
    await work(async (trx) => {
      const editing = await findRole(trx, 'Editing');
      await grant(trx, {
        roleId: editing!.id,
        subject: { principal: ada },
        level: { kind: 'artifact', id: others.artifactId },
        effect: 'deny',
        grantedBy: ada,
      });
      await claimLock(trx, {
        artifactId: held.artifactId,
        principal: grace,
        session: 'aaaaaaaa-0000-4000-8000-00000000aaaa',
      });
      const moved = await moveArtifact(trx, {
        artifactId: translated.artifactId,
        kind: 'component',
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
      });
      if (moved.answer !== 'moved') throw new Error(moved.answer);
      const passed = await decideGate(trx, {
        artifactId: translated.artifactId,
        kind: 'component',
        transition: 'approve',
        version: translated.id,
        decision: 'approved',
        by: grace,
        may: () => true,
      });
      if (passed.answer !== 'passed') throw new Error(passed.answer);
      const line = await beginTranslation(trx, {
        artifactId: translated.artifactId,
        language: 'fr-FR',
        by: ada,
      });
      if (line.answer !== 'begun') throw new Error(line.answer);
      await deleteArtifact(trx, gone.artifactId, ada);
    });
    // Deleted since it was placed: a stored outline can name one, and placing one now is refused.
    const opened = await work(async (trx) => {
      const content = placed.content as OutlineDocument;
      const answer = await recordVersion(trx, {
        artifactId: placed.artifactId,
        openedFrom: placed.id,
        author: ada,
        substance: {
          kind: 'document',
          content: {
            ...content,
            nodes: [
              ...content.nodes,
              {
                ...content.nodes[0]!,
                id: 'a'.repeat(26),
                component: gone.artifactId,
                mode: { kind: 'pinned', version: gone.id },
              } as OutlineDocument['nodes'][number],
            ],
          },
          values: placed.values,
          parameters: placed.parameters,
        },
      });
      if (answer.answer !== 'recorded') throw new Error(answer.answer);
      return answer.version;
    });

    const answer = await change(opened, 'fr-FR');
    expect(answer).toMatchObject({
      answer: 'changed',
      changed: [free.artifactId],
      skipped: { notPermitted: 1, locked: 1, pinnedBehind: 1, translated: 1, missing: 1 },
    });
    expect(await spoken(free.artifactId)).toBe('fr-FR ltr');
    for (const each of [others, held, behind, translated]) {
      expect(await spoken(each.artifactId)).toBe('en-GB ltr');
    }
    expect(await spoken(opened.artifactId)).toBe('fr-FR ltr');
  });

  it('refuses a language a title is translated into, changing nothing', async () => {
    const placed = await component();
    const opened = await placing(placed);
    const titled = await work(async (trx) => {
      const answer = await editOutline(trx, {
        artifactId: opened.artifactId,
        openedFrom: opened.id,
        author: ada,
        operation: { operation: 'translateTitle', node: null, language: 'fr', title: 'Le rapport' },
      });
      if (answer.answer !== 'recorded') throw new Error(answer.answer);
      return answer.version;
    });
    const answer = await change(titled, 'fr-FR');
    expect(answer).toMatchObject({ answer: 'outline.invalid' });
    expect((await latest(opened.artifactId)).id).toBe(titled.id);
    expect(await spoken(placed.artifactId)).toBe('en-GB ltr');
  });

  it('counts nothing for a component already in the language that the caller may not edit', async () => {
    const placed = await component();
    const opened = await placing(placed);
    await work(async (trx) => {
      const editing = await findRole(trx, 'Editing');
      await grant(trx, {
        roleId: editing!.id,
        subject: { principal: ada },
        level: { kind: 'artifact', id: placed.artifactId },
        effect: 'deny',
        grantedBy: ada,
      });
    });
    expect(await change(opened, 'en-GB')).toMatchObject({ skipped: NONE, changed: [] });
  });

  it('skips an archived component as one it may not change', async () => {
    const placed = await component();
    const opened = await placing(placed);
    await work((trx) => archiveArtifact(trx, placed.artifactId, ada));
    expect(await change(opened, 'fr-FR')).toMatchObject({
      answer: 'changed',
      changed: [],
      skipped: { ...NONE, notPermitted: 1 },
    });
    expect(await spoken(placed.artifactId)).toBe('en-GB ltr');
  });

  it('refuses an archived document, changing nothing', async () => {
    const placed = await component();
    const opened = await placing(placed);
    await work((trx) => archiveArtifact(trx, opened.artifactId, ada));
    expect(await change(opened, 'fr-FR')).toEqual({ answer: 'artifact.archived' });
    expect(await spoken(placed.artifactId)).toBe('en-GB ltr');
    expect(await spoken(opened.artifactId)).toBe('en-GB ltr');
  });

  it('refuses a version since moved on, changing nothing', async () => {
    const placed = await component();
    const opened = await placing(placed);
    await change(opened, 'fr-FR', false);
    const answer = await change(opened, 'de-DE');
    expect(answer).toMatchObject({ answer: 'version.precondition' });
    expect(await spoken(placed.artifactId)).toBe('en-GB ltr');
  });
});
