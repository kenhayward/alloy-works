// packages/db/src/recovery.test.ts
import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  definitionsFor,
  type ComponentTypeDefinition,
  type ContentDocument,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { claimLock, ITERATION_RETENTION_DAYS, saveIteration } from './editing.js';
import { migrate } from './migrate.js';
import { cutVersion } from './promotion.js';
import { createTenant, type Tenant } from './provision.js';
import { listIterations, newestUncutIteration, readIteration } from './recovery.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { createArtifact } from './versions.js';

const content = (text: string): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: text === '' ? [] : [{ type: 'text', value: text, marks: [] }],
    },
  ],
});

describe('reading iterations back for Recovery', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  const people: Record<'ada' | 'grace', string> = { ada: '', grace: '' };
  let definitions: ReturnType<typeof definitionsFor>;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(tenant, async (trx) => {
      for (const who of ['ada', 'grace'] as const) {
        people[who] = (
          await trx
            .insertInto('principal')
            .values({
              issuer: 'https://idp.example',
              subject: who,
              email: null,
              display_name: who === 'ada' ? 'Ada' : 'Grace',
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      }
      const type: ComponentTypeDefinition = {
        schemaVersion: DEFINITION_SCHEMA_VERSION,
        id: randomUUID(),
        name: 'Procedure',
        assignments: [],
      };
      const stored = await createArtifact(trx, {
        author: people.ada,
        substance: { kind: 'componentType', content: type },
      });
      definitions = definitionsFor({ version: stored.id, definition: type }, [], []);
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  /**
   * A new component at its first version. `session` claims it for one of Ada's or Grace's sessions,
   * moving it from their own other one; `save` writes the next iteration of that session against the
   * version the component is at; `cut` makes the next version from the session's latest iteration.
   */
  const component = async () => {
    const general = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('space').select('id').where('name', '=', 'General').executeTakeFirstOrThrow(),
    );
    const made = await service.withTenant(tenant, (trx) =>
      createArtifact(trx, {
        author: people.ada,
        spaceId: general.id,
        substance: {
          kind: 'component',
          content: content(''),
          values: {},
          notCarried: [],
          definitions,
        },
      }),
    );
    let at = made.id;
    const session = async (who: 'ada' | 'grace') => {
      const id = randomUUID();
      let sequence = 0;
      const claimed = await service.withTenant(tenant, (trx) =>
        claimLock(trx, {
          artifactId: made.artifactId,
          principal: people[who],
          session: id,
          move: true,
        }),
      );
      if (claimed.answer !== 'claimed') throw new Error(claimed.answer);
      const save = async (text: string): Promise<string> => {
        sequence += 1;
        const answer = await service.withTenant(tenant, (trx) =>
          saveIteration(trx, {
            artifactId: made.artifactId,
            principal: people[who],
            session: id,
            sequence,
            openedFrom: at,
            content: content(text),
          }),
        );
        if (answer.answer !== 'accepted') throw new Error(answer.answer);
        const row = await service.withTenant(tenant, (trx) =>
          trx
            .selectFrom('iteration')
            .select('id')
            .where('artifact_id', '=', made.artifactId)
            .where('session_id', '=', id)
            .where('sequence', '=', sequence)
            .executeTakeFirstOrThrow(),
        );
        return row.id;
      };
      const cut = async (): Promise<string> => {
        const answer = await service.withTenant(tenant, (trx) =>
          cutVersion(trx, {
            artifactId: made.artifactId,
            principal: people[who],
            session: id,
            openedFrom: at,
          }),
        );
        if (answer.answer !== 'recorded') throw new Error(answer.answer);
        at = answer.version.id;
        return at;
      };
      return { id, save, cut };
    };
    /** Lets the lock lapse, as the administrator: a lapsed lock is one anybody may claim. */
    const lapse = () =>
      queryAs(
        db.adminUrl,
        `update "${tenant.schema}".component_lock
            set claimed_at = now() - interval '20 minutes', expires_at = now() - interval '1 minute'
          where artifact_id = $1`,
        [made.artifactId],
      );
    return { id: made.artifactId, first: made.id, session, lapse };
  };

  const list = (artifactId: string, who: 'ada' | 'grace', limit = 50) =>
    service.withTenant(tenant, (trx) =>
      listIterations(trx, { artifactId, principalId: people[who], limit }),
    );

  it("CNT-174 lists the writer's own iterations of the component, newest first from any of their sessions, with no content and nobody else's", async () => {
    const made = await component();
    const first = await made.session('ada');
    const a1 = await first.save('Unbox the printer.');
    const a2 = await first.save('Unbox the printer and keep the box.');
    // Ada's second window, which moved the lock to itself.
    const second = await made.session('ada');
    const a3 = await second.save('Plug it in.');
    await made.lapse();
    const grace = await made.session('grace');
    const g1 = await grace.save('Switch it on.');

    const page = await list(made.id, 'ada');
    expect(page.next).toBeNull();
    expect(page.items.map((each) => each.id)).toEqual([a3, a2, a1]);
    expect(page.items[0]).toEqual({
      id: a3,
      sessionId: second.id,
      sequence: 1,
      createdAt: expect.any(Date),
      openedFrom: { id: made.first, number: '0.1' },
    });
    expect(page.items[1]).toMatchObject({ sessionId: first.id, sequence: 2 });
    expect(page.items[0]!.createdAt.getTime()).toBeGreaterThan(page.items[1]!.createdAt.getTime());
    expect(page.items.some((each) => 'content' in each)).toBe(false);

    // Grace, who holds it now, sees her own and never Ada's.
    expect((await list(made.id, 'grace')).items.map((each) => each.id)).toEqual([g1]);
    // And an iteration of another component is not this one's.
    const other = await component();
    await (await other.session('ada')).save('Audit the fleet.');
    expect((await list(made.id, 'ada')).items).toHaveLength(3);
  });

  it('CNT-090 pages the listing a keyset at a time, newest first, to the end', async () => {
    const made = await component();
    const ada = await made.session('ada');
    const saved: string[] = [];
    for (const text of ['One.', 'Two.', 'Three.', 'Four.', 'Five.'])
      saved.push(await ada.save(text));

    const first = await list(made.id, 'ada', 2);
    expect(first.items.map((each) => each.id)).toEqual([saved[4], saved[3]]);
    expect(first.next).not.toBeNull();
    const second = await service.withTenant(tenant, (trx) =>
      listIterations(trx, {
        artifactId: made.id,
        principalId: people.ada,
        limit: 2,
        after: first.next!,
        snapshot: first.snapshot,
      }),
    );
    expect(second.items.map((each) => each.id)).toEqual([saved[2], saved[1]]);
    const third = await service.withTenant(tenant, (trx) =>
      listIterations(trx, {
        artifactId: made.id,
        principalId: people.ada,
        limit: 2,
        after: second.next!,
        snapshot: first.snapshot,
      }),
    );
    expect(third.items.map((each) => each.id)).toEqual([saved[0]]);
    expect(third.next).toBeNull();
  });

  it('CNT-090 lists and reads only the iterations the sweep keeps, naming the version each was written against', async () => {
    const made = await component();
    const ada = await made.session('ada');
    const before = await ada.save('Unbox the printer.');
    const next = await ada.cut();
    const after = await ada.save('Plug it in.');

    const listed = await list(made.id, 'ada');
    expect(listed.items.map((each) => [each.id, each.openedFrom.number])).toEqual([
      [after, '0.2'],
      [before, '0.1'],
    ]);
    expect(listed.items[0]!.openedFrom.id).toBe(next);

    await queryAs(
      db.adminUrl,
      `update "${tenant.schema}".artifact_version
          set created_at = now() - make_interval(days => $2) where id = $1`,
      [next, ITERATION_RETENTION_DAYS],
    );
    expect((await list(made.id, 'ada')).items.map((each) => each.id)).toEqual([after]);
    expect(
      await service.withTenant(tenant, (trx) =>
        readIteration(trx, { artifactId: made.id, principalId: people.ada, iterationId: before }),
      ),
    ).toBeUndefined();
  });

  it("CNT-174 reads one of the writer's own iterations whole, content and values, and nobody else's, nor another component's", async () => {
    const made = await component();
    const ada = await made.session('ada');
    const mine = await ada.save('Unbox the printer.');
    await made.lapse();
    const theirs = await (await made.session('grace')).save('Switch it on.');
    const read = (who: 'ada' | 'grace', iterationId: string, artifactId = made.id) =>
      service.withTenant(tenant, (trx) =>
        readIteration(trx, { artifactId, principalId: people[who], iterationId }),
      );

    expect(await read('ada', mine)).toEqual({
      id: mine,
      sessionId: ada.id,
      sequence: 1,
      createdAt: expect.any(Date),
      openedFrom: { id: made.first, number: '0.1' },
      content: content('Unbox the printer.'),
      values: {},
    });
    expect(await read('ada', theirs)).toBeUndefined();
    expect(await read('grace', mine)).toBeUndefined();
    const other = await component();
    expect(await read('ada', mine, other.id)).toBeUndefined();
    expect(await read('ada', 'not-an-id')).toBeUndefined();
    expect(await read('ada', randomUUID())).toBeUndefined();
  });

  it('says when the caller last saved work never made a version, and nothing of anybody else', async () => {
    const made = await component();
    const uncut = (who: 'ada' | 'grace') =>
      service.withTenant(tenant, (trx) =>
        newestUncutIteration(trx, { artifactId: made.id, principalId: people[who] }),
      );
    expect(await uncut('ada')).toBeNull();

    const ada = await made.session('ada');
    await ada.save('Unbox the printer.');
    const newest = await ada.save('Unbox the printer and keep the box.');
    const at = await service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('iteration')
        .select('created_at')
        .where('id', '=', newest)
        .executeTakeFirstOrThrow(),
    );
    expect(await uncut('ada')).toEqual(at.created_at);
    expect(await uncut('grace')).toBeNull();

    // Made a version: the iterations are of the version before, and nothing is unsaved.
    await ada.cut();
    expect(await uncut('ada')).toBeNull();

    // Changed and changed back: what was saved last is what the latest version holds, so nothing
    // saved is missing from a version, whatever came before it.
    await ada.save('Unbox the printer, keep the box and the manual.');
    expect(await uncut('ada')).not.toBeNull();
    await ada.save('Unbox the printer and keep the box.');
    expect(await uncut('ada')).toBeNull();
  });

  it('still says so once somebody else has cut a version without that work, for as long as it is kept', async () => {
    const made = await component();
    const uncut = () =>
      service.withTenant(tenant, (trx) =>
        newestUncutIteration(trx, { artifactId: made.id, principalId: people.ada }),
      );
    const ada = await made.session('ada');
    const mine = await ada.save('Unbox the printer and keep the box.');
    const at = await service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('iteration')
        .select('created_at')
        .where('id', '=', mine)
        .executeTakeFirstOrThrow(),
    );
    // Ada's lock lapses, and Grace makes a version of her own text, which is not Ada's.
    await made.lapse();
    const grace = await made.session('grace');
    await grace.save('Switch it on.');
    const theirs = await grace.cut();
    expect(await uncut()).toEqual(at.created_at);

    // Past the window after that cut, it is swept, and nothing is offered.
    await queryAs(
      db.adminUrl,
      `update "${tenant.schema}".artifact_version
          set created_at = now() - make_interval(days => $2) where id = $1`,
      [theirs, ITERATION_RETENTION_DAYS],
    );
    expect(await uncut()).toBeNull();
  });

  it("offers none of the author's own work once a version holds it, even where that version is not the latest", async () => {
    const made = await component();
    const uncut = () =>
      service.withTenant(tenant, (trx) =>
        newestUncutIteration(trx, { artifactId: made.id, principalId: people.ada }),
      );
    const ada = await made.session('ada');
    await ada.save('Unbox the printer.');
    await ada.save('Unbox the printer and keep the box.');
    await ada.cut();
    await made.lapse();
    const grace = await made.session('grace');
    await grace.save('Switch it on.');
    await grace.cut();
    expect(await uncut()).toBeNull();
  });
});
