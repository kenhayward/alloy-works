import { decide, type Level, type Permission } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { grant, type NewGrant } from './grants.js';
import {
  createGroup,
  deleteGroup,
  listGroups,
  setGroupMembers,
  syncProviderGroups,
  type ListedGroup,
} from './groups.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

/** Thrown to roll a transaction back once what it held has been looked at. */
class RolledBack extends Error {}

describe('groups: made, filled, deleted, and followed from the provider (access.md, "Groups")', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let alice: string;
  let clinical: string;
  let theirPrincipal: string;
  const roles: Record<string, string> = {};

  const principal = (
    trx: TenantTransaction,
    subject: string,
    name: string,
    kind: 'user' | 'external' = 'user',
  ) =>
    trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject,
        email: `${subject}@example.com`,
        display_name: name,
        kind,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const within = <T>(run: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, run);

  const give = async (input: Omit<NewGrant, 'grantedBy'>) => {
    const answer = await within((trx) => grant(trx, { ...input, grantedBy: ada }));
    if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
    return answer.granted;
  };

  const may = (who: string, permission: Permission, target: Level) =>
    within(async (trx) => {
      const facts = await loadFacts(trx, who, target);
      return facts !== undefined && decide(permission, facts).allowed;
    });

  const made = async (name: string, providerValue?: string) => {
    const answer = await within((trx) =>
      createGroup(trx, name, providerValue === undefined ? {} : { providerValue }),
    );
    if (!('group' in answer)) throw new Error(`refused: ${answer.refused}`);
    return answer.group.id;
  };

  const membersOf = (groupId: string) =>
    within((trx) =>
      trx
        .selectFrom('group_member')
        .select(['principal_id', 'asserted_at'])
        .where('group_id', '=', groupId)
        .orderBy('principal_id')
        .execute(),
    );

  /** Whether another transaction could take the epoch FOR SHARE right now, without waiting. */
  const shareable = () =>
    within((trx) => sql`select changed_at from access_epoch for share nowait`.execute(trx)).then(
      () => true,
      (error: Error) => {
        if (/could not obtain lock/.test(error.message)) return false;
        throw error;
      },
    );

  /** Runs a write, answers whether the epoch was still shareable meanwhile, and rolls it back. */
  const whileHeld = async (write: (trx: TenantTransaction) => Promise<unknown>) => {
    let answer: boolean | undefined;
    await within(async (trx) => {
      await write(trx);
      answer = await shareable();
      throw new RolledBack();
    }).catch((error: unknown) => {
      if (!(error instanceof RolledBack)) throw error;
    });
    return answer;
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await within(async (trx) => {
      ada = await principal(trx, 'ada', 'Ada');
      grace = await principal(trx, 'grace', 'Grace');
      alice = await principal(trx, 'alice', 'Alice', 'external');
      clinical = (await createSpace(trx, 'Clinical')).id;
      for (const name of ['Reader', 'Author', 'Publisher']) {
        roles[name] = (await findRole(trx, name))!.id;
      }
    });
    theirPrincipal = await service.withTenant(development, (trx) => principal(trx, 'ivy', 'Ivy'));
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  describe('making and listing', () => {
    it("makes the environment's own group by name, and one standing for a provider's value", async () => {
      const own = await within((trx) => createGroup(trx, 'Reviewers'));
      const directory = await within((trx) =>
        createGroup(trx, 'Directory reviewers', { providerValue: 'reviewers' }),
      );
      expect(own).toMatchObject({
        group: { name: 'Reviewers', source: 'tenant', providerValue: null },
      });
      expect(directory).toMatchObject({
        group: { name: 'Directory reviewers', source: 'provider', providerValue: 'reviewers' },
      });
    });

    it('refuses a name already taken, and a value another group already stands for', async () => {
      await made('Taken');
      await made('Stands for taken', 'taken-value');
      await expect(within((trx) => createGroup(trx, 'Taken'))).resolves.toEqual({
        refused: 'group.name_taken',
      });
      await expect(
        within((trx) => createGroup(trx, 'Another name', { providerValue: 'taken-value' })),
      ).resolves.toEqual({ refused: 'group.value_taken' });
    });

    it('lists groups a page at a time in the order of their ids, each with its members by name', async () => {
      const listed = await made('Listed');
      await within((trx) => setGroupMembers(trx, listed, [grace, ada]));

      const everything: ListedGroup[] = [];
      let after: string | undefined;
      for (;;) {
        const page = await within((trx) =>
          listGroups(trx, { ...(after === undefined ? {} : { after }), limit: 2 }),
        );
        expect(page.items.length).toBeLessThanOrEqual(2);
        everything.push(...page.items);
        if (page.after === null) break;
        after = page.after;
      }
      const ids = everything.map((each) => each.id);
      expect(ids).toEqual([...ids].sort());
      expect(new Set(ids).size).toBe(ids.length);
      const found = everything.find((each) => each.id === listed);
      expect(found).toMatchObject({ name: 'Listed', source: 'tenant', providerValue: null });
      expect(found?.members.map((each) => each.name)).toEqual(['Ada', 'Grace']);
    });

    it('lists nothing after a cursor it did not give out', async () => {
      await expect(
        within((trx) => listGroups(trx, { after: 'not-a-cursor', limit: 10 })),
      ).resolves.toEqual({ items: [], after: null });
    });
  });

  describe("setting a group's members", () => {
    it('makes the members exactly those named, each once', async () => {
      const group = await made('Editors');
      await expect(within((trx) => setGroupMembers(trx, group, [ada, grace]))).resolves.toEqual({
        set: true,
      });
      expect((await membersOf(group)).map((each) => each.principal_id).sort()).toEqual(
        [ada, grace].sort(),
      );
      await within((trx) => setGroupMembers(trx, group, [grace, grace]));
      expect((await membersOf(group)).map((each) => each.principal_id)).toEqual([grace]);
      await within((trx) => setGroupMembers(trx, group, []));
      expect(await membersOf(group)).toEqual([]);
    });

    it("refuses to fill a provider's group by hand", async () => {
      const directory = await made('Directory editors', 'editors');
      await expect(within((trx) => setGroupMembers(trx, directory, [ada]))).resolves.toEqual({
        refused: 'group.from_provider',
      });
      expect(await membersOf(directory)).toEqual([]);
    });

    it("answers a group or a person that is not this environment's as missing, and changes nothing", async () => {
      const group = await made('Nobody from elsewhere');
      const theirGroup = await service.withTenant(development, (trx) => createGroup(trx, 'Theirs'));
      if (!('group' in theirGroup)) throw new Error('the group was not made');
      await expect(
        within((trx) => setGroupMembers(trx, theirGroup.group.id, [ada])),
      ).resolves.toEqual({ refused: 'group.missing' });
      await expect(
        within((trx) => setGroupMembers(trx, group, [ada, theirPrincipal])),
      ).resolves.toEqual({ refused: 'group.member_missing' });
      expect(await membersOf(group)).toEqual([]);
    });

    it('holds an external member to the rules a grant to them directly is held to', async () => {
      const group = await made('Tenant readers');
      await give({
        roleId: roles.Reader!,
        subject: { group },
        level: { kind: 'tenant' },
        effect: 'allow',
      });
      await expect(within((trx) => setGroupMembers(trx, group, [ada, alice]))).resolves.toEqual({
        refused: 'grant.external_at_tenant',
      });
      expect(await membersOf(group)).toEqual([]);
    });
  });

  describe('deleting a group', () => {
    it('takes its grants and its memberships with it, so the next decision refuses', async () => {
      const group = await made('Clinical authors');
      await within((trx) => setGroupMembers(trx, group, [grace]));
      await give({
        roleId: roles.Author!,
        subject: { group },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
      });
      expect(await may(grace, 'create', { kind: 'space', id: clinical })).toBe(true);

      await expect(within((trx) => deleteGroup(trx, group))).resolves.toEqual({ deleted: group });

      expect(await may(grace, 'create', { kind: 'space', id: clinical })).toBe(false);
      const left = await within((trx) =>
        trx.selectFrom('access_grant').select('id').where('group_id', '=', group).execute(),
      );
      expect(left).toEqual([]);
      expect(await membersOf(group)).toEqual([]);
    });

    it("keeps a group's grants from outliving it, whoever deletes the row", async () => {
      const group = await made('Deleted by hand');
      await give({
        roleId: roles.Reader!,
        subject: { group },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
      });
      await within((trx) => trx.deleteFrom('access_group').where('id', '=', group).execute());
      const left = await within((trx) =>
        trx.selectFrom('access_grant').select('id').where('group_id', '=', group).execute(),
      );
      expect(left).toEqual([]);
    });

    it('takes the access epoch, and answers a group that is not there as missing', async () => {
      const group = await made('Short lived');
      await expect(whileHeld((trx) => deleteGroup(trx, group))).resolves.toBe(false);
      await within((trx) => deleteGroup(trx, group));
      await expect(within((trx) => deleteGroup(trx, group))).resolves.toEqual({
        refused: 'group.missing',
      });
    });
  });

  describe("following the provider's claim at sign-in", () => {
    let authors: string;
    let publishers: string;
    let staff: string;

    beforeAll(async () => {
      authors = await made('Directory authors', 'authors');
      publishers = await made('Directory publishers', 'publishers');
      staff = await made('Staff');
      await within((trx) => setGroupMembers(trx, staff, [ada]));
      await give({
        roleId: roles.Author!,
        subject: { group: authors },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
      });
    });

    it('IAM-009 gives a principal the role a provider group holds while the claim carries its value, and takes it away when it does not', async () => {
      const clinicalSpace: Level = { kind: 'space', id: clinical };
      expect(await may(ada, 'create', clinicalSpace)).toBe(false);

      await within((trx) => syncProviderGroups(trx, ada, ['authors']));
      expect(await may(ada, 'create', clinicalSpace)).toBe(true);

      await within((trx) => syncProviderGroups(trx, ada, ['somebody-else']));
      expect(await may(ada, 'create', clinicalSpace)).toBe(false);
    });

    it('ignores a value no group stands for, and matches a value exactly', async () => {
      await within((trx) => syncProviderGroups(trx, grace, ['unmapped', 'AUTHORS', 'publishers']));
      expect(await membersOf(authors)).not.toContainEqual(
        expect.objectContaining({ principal_id: grace }),
      );
      expect((await membersOf(publishers)).map((each) => each.principal_id)).toContain(grace);
      const groups = await within((trx) =>
        trx.selectFrom('access_group').select('provider_value').execute(),
      );
      expect(groups.map((each) => each.provider_value)).not.toContain('unmapped');
    });

    it('empties every provider membership for no values, and leaves the groups an administrator fills alone', async () => {
      await within((trx) => syncProviderGroups(trx, ada, ['authors', 'publishers']));
      await within((trx) => syncProviderGroups(trx, ada, []));
      for (const group of [authors, publishers]) {
        expect((await membersOf(group)).map((each) => each.principal_id)).not.toContain(ada);
      }
      expect((await membersOf(staff)).map((each) => each.principal_id)).toEqual([ada]);
    });

    it('changes only the memberships that differ: the same values again take no lock, and say when they were last asserted', async () => {
      await within((trx) => syncProviderGroups(trx, grace, ['authors', 'publishers']));
      const [before] = (await membersOf(authors)).filter((each) => each.principal_id === grace);
      expect(before?.asserted_at).toBeInstanceOf(Date);

      await expect(
        whileHeld((trx) => syncProviderGroups(trx, grace, ['publishers', 'authors'])),
      ).resolves.toBe(true);
      await within((trx) => syncProviderGroups(trx, grace, ['publishers', 'authors']));
      const [after] = (await membersOf(authors)).filter((each) => each.principal_id === grace);
      expect(after!.asserted_at!.getTime()).toBeGreaterThan(before!.asserted_at!.getTime());

      await expect(
        whileHeld((trx) => syncProviderGroups(trx, grace, ['publishers'])),
      ).resolves.toBe(false);
      await expect(
        whileHeld((trx) => syncProviderGroups(trx, grace, ['publishers', 'authors', 'unmapped'])),
      ).resolves.toBe(true);
    });

    it('places an external principal in a provider group, which no administrator can refuse, and leaves the cap to the decision', async () => {
      await within((trx) => syncProviderGroups(trx, alice, ['authors']));
      expect((await membersOf(authors)).map((each) => each.principal_id)).toContain(alice);
      expect(await may(alice, 'create', { kind: 'space', id: clinical })).toBe(false);
    });
  });
});
