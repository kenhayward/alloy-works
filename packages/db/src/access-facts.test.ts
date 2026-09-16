import { decide, type Level } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lockAccessForChange, loadFacts, loadReadableSet } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { grant, type NewGrant } from './grants.js';
import { addToGroup, createGroup } from './groups.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

/** A promise and the function that settles it: what two transactions take turns on. */
function latch() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

describe('the facts a decision reads', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let clinical: string;
  let quality: string;
  let dosing: string;
  let audit: string;
  let field: string;
  const roles: Record<string, string> = {};

  const principal = (trx: TenantTransaction, subject: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject, email: null, display_name: null })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const artifact = (trx: TenantTransaction, spaceId: string | null) =>
    trx
      .insertInto('artifact')
      .values({ kind: spaceId === null ? 'field' : 'component', space_id: spaceId })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const give = async (input: Omit<NewGrant, 'grantedBy'>) => {
    const answer = await service.withTenant(production, (trx) =>
      grant(trx, { ...input, grantedBy: ada }),
    );
    if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
    return answer.granted;
  };

  const may = (who: string, permission: 'read' | 'edit', target: Level) =>
    service.withTenant(production, async (trx) => {
      const facts = await loadFacts(trx, who, target);
      return facts && decide(permission, facts).allowed;
    });

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
      ada = await principal(trx, 'ada');
      grace = await principal(trx, 'grace');
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      dosing = await artifact(trx, clinical);
      audit = await artifact(trx, quality);
      field = await artifact(trx, null);
      for (const name of ['Reader', 'Author', 'Editing']) {
        roles[name] = (await findRole(trx, name))!.id;
      }
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('loads the chain, the groups and the grants that may reach the principal, and nothing else', async () => {
    const editors = await service.withTenant(production, async (trx) => {
      const made = await createGroup(trx, 'Editors');
      if (!('group' in made)) throw new Error('the group was not made');
      await addToGroup(trx, made.group.id, grace);
      return made.group.id;
    });
    const direct = await give({
      roleId: roles.Reader!,
      subject: { principal: grace },
      level: { kind: 'tenant' },
      effect: 'allow',
    });
    const throughGroup = await give({
      roleId: roles.Author!,
      subject: { group: editors },
      level: { kind: 'artifact', id: dosing },
      effect: 'allow',
    });
    await give({
      roleId: roles.Author!,
      subject: { principal: ada },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
    });
    await give({
      roleId: roles.Author!,
      subject: { principal: grace },
      level: { kind: 'space', id: quality },
      effect: 'allow',
    });
    await give({
      roleId: roles.Author!,
      subject: { principal: grace },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
      expiresAt: new Date(Date.now() - 1000),
    });

    const facts = await service.withTenant(production, (trx) =>
      loadFacts(trx, grace, { kind: 'artifact', id: dosing }),
    );
    expect(facts).toMatchObject({
      principal: { id: grace, kind: 'user' },
      groups: [editors],
      chain: [
        { kind: 'artifact', id: dosing },
        { kind: 'space', id: clinical },
        { kind: 'tenant' },
      ],
    });
    expect(facts!.now).toBeInstanceOf(Date);
    expect(facts!.grants.map((reached) => reached.id).sort()).toEqual(
      [direct.id, throughGroup.id].sort(),
    );
    expect(facts!.grants.find((reached) => reached.id === throughGroup.id)).toEqual({
      id: throughGroup.id,
      role: {
        id: roles.Author,
        name: 'Author',
        permissions: ['read', 'create', 'edit', 'comment', 'suggest'],
      },
      subject: { group: editors },
      level: { kind: 'artifact', id: dosing },
      effect: 'allow',
      expiresAt: null,
    });

    await expect(
      service.withTenant(production, (trx) =>
        loadFacts(trx, grace, { kind: 'artifact', id: field }),
      ),
    ).resolves.toMatchObject({ chain: [{ kind: 'artifact', id: field }, { kind: 'tenant' }] });
    await expect(
      service.withTenant(production, (trx) => loadFacts(trx, grace, { kind: 'tenant' })),
    ).resolves.toMatchObject({ chain: [{ kind: 'tenant' }], grants: [{ id: direct.id }] });
  });

  it("finds nothing for a target or a principal the tenant does not hold, another tenant's included", async () => {
    const theirs = await service.withTenant(development, async (trx) => ({
      principal: await principal(trx, 'alice'),
      space: (await createSpace(trx, 'Theirs')).id,
      artifact: await artifact(trx, null),
    }));
    const load = (who: string, target: Level) =>
      service.withTenant(production, (trx) => loadFacts(trx, who, target));
    await expect(load(ada, { kind: 'space', id: theirs.space })).resolves.toBeUndefined();
    await expect(load(ada, { kind: 'artifact', id: theirs.artifact })).resolves.toBeUndefined();
    await expect(load(theirs.principal, { kind: 'tenant' })).resolves.toBeUndefined();
  });

  it('denies from a group even though the same principal also holds a direct allow, so a grant loaded from the database is never built with both a principal and a group', async () => {
    const muted = await service.withTenant(production, (trx) => principal(trx, 'muted'));
    const silenced = await service.withTenant(production, async (trx) => {
      const made = await createGroup(trx, 'Silenced');
      if (!('group' in made)) throw new Error('the group was not made');
      await addToGroup(trx, made.group.id, muted);
      return made.group.id;
    });
    // A direct allow of edit at the artifact, which a correctly-built group denial at the same
    // level must still beat. Built as `{ principal: null, group: silenced }` instead of
    // `{ group: silenced }`, the denial would never match the principal in `decide` and this would
    // wrongly resolve to true.
    await give({
      roleId: roles.Author!,
      subject: { principal: muted },
      level: { kind: 'artifact', id: dosing },
      effect: 'allow',
    });
    await give({
      roleId: roles.Editing!,
      subject: { group: silenced },
      level: { kind: 'artifact', id: dosing },
      effect: 'deny',
    });
    await expect(may(muted, 'edit', { kind: 'artifact', id: dosing })).resolves.toBe(false);
  });

  it("IAM-014 decides at a space for everything in it, below the tenant, and never at another tenant's", async () => {
    await expect(may(ada, 'edit', { kind: 'artifact', id: dosing })).resolves.toBe(true);
    await expect(may(ada, 'edit', { kind: 'space', id: clinical })).resolves.toBe(true);
    await expect(may(ada, 'edit', { kind: 'artifact', id: audit })).resolves.toBe(false);
    await expect(may(ada, 'edit', { kind: 'tenant' })).resolves.toBe(false);

    const theirs = await service.withTenant(development, (trx) => createSpace(trx, 'Clinical'));
    await expect(may(ada, 'edit', { kind: 'space', id: theirs.id })).resolves.toBeUndefined();
    await expect(
      give({
        roleId: roles.Author!,
        subject: { principal: ada },
        level: { kind: 'space', id: theirs.id },
        effect: 'allow',
      }),
    ).rejects.toThrow(/access_grant_space_id_fkey/);
  });

  it("IAM-027 answers from the grants as they are, so changing a role changes every holder's next decision", async () => {
    await expect(may(ada, 'edit', { kind: 'artifact', id: dosing })).resolves.toBe(true);
    await service.withTenant(production, (trx) =>
      trx
        .updateTable('role')
        .set({ permissions: ['read', 'create', 'comment', 'suggest'] })
        .where('id', '=', roles.Author!)
        .execute(),
    );
    await expect(may(ada, 'edit', { kind: 'artifact', id: dosing })).resolves.toBe(false);
    await expect(may(ada, 'read', { kind: 'artifact', id: dosing })).resolves.toBe(true);
    await service.withTenant(production, (trx) =>
      trx
        .updateTable('role')
        .set({ permissions: ['read', 'create', 'edit', 'comment', 'suggest'] })
        .where('id', '=', roles.Author!)
        .execute(),
    );
    await expect(may(ada, 'edit', { kind: 'artifact', id: dosing })).resolves.toBe(true);
  });

  it('IAM-063 takes a decision with its act, so a revocation waits for an authorised write and a later write sees it', async () => {
    const revocable = await give({
      roleId: roles.Author!,
      subject: { principal: ada },
      level: { kind: 'artifact', id: dosing },
      effect: 'allow',
    });
    // Leave only this grant deciding edit for Ada on the component.
    await service.withTenant(production, (trx) =>
      trx
        .deleteFrom('access_grant')
        .where('principal_id', '=', ada)
        .where('id', '<>', revocable.id)
        .execute(),
    );
    const order: string[] = [];
    const decided = latch();
    const release = latch();

    const act = service.withTenant(production, async (trx) => {
      const facts = await loadFacts(trx, ada, { kind: 'artifact', id: dosing });
      const allowed = decide('edit', facts!).allowed;
      decided.open();
      await release.opened;
      await sql`update profile set updated_at = now()`.execute(trx);
      order.push('act committed');
      return allowed;
    });
    await decided.opened;

    // While the act holds its decision, a revocation cannot take the epoch's lock...
    await expect(
      service.withTenant(production, async (trx) => {
        await sql`set local lock_timeout = '200ms'`.execute(trx);
        await trx.deleteFrom('access_grant').where('id', '=', revocable.id).execute();
      }),
    ).rejects.toThrow(/lock timeout/);

    // ...so a revocation begun now waits for the act to commit, and lands after it.
    const revocation = service
      .withTenant(production, (trx) =>
        trx.deleteFrom('access_grant').where('id', '=', revocable.id).execute(),
      )
      .then(() => order.push('revocation committed'));
    release.open();
    await expect(act).resolves.toBe(true);
    await revocation;
    expect(order).toEqual(['act committed', 'revocation committed']);

    // And a decision begun while a change is uncommitted waits for it, then sees it.
    const regranted = latch();
    const commit = latch();
    const change = service.withTenant(production, async (trx) => {
      await grant(trx, {
        roleId: roles.Author!,
        subject: { principal: ada },
        level: { kind: 'artifact', id: dosing },
        effect: 'deny',
        grantedBy: ada,
      });
      regranted.open();
      await commit.opened;
    });
    await regranted.opened;
    await expect(
      service.withTenant(production, async (trx) => {
        await sql`set local lock_timeout = '200ms'`.execute(trx);
        return loadFacts(trx, ada, { kind: 'artifact', id: dosing });
      }),
    ).rejects.toThrow(/lock timeout/);
    const waiting = may(ada, 'read', { kind: 'artifact', id: dosing });
    commit.open();
    await change;
    await expect(waiting).resolves.toBe(false);
  });

  it('leaves an author of a space read-only on one component, by denying Editing there', async () => {
    const writer = await service.withTenant(production, (trx) => principal(trx, 'writer'));
    await give({
      roleId: roles.Author!,
      subject: { principal: writer },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
    });
    await give({
      roleId: roles.Editing!,
      subject: { principal: writer },
      level: { kind: 'artifact', id: dosing },
      effect: 'deny',
    });
    await expect(may(writer, 'read', { kind: 'artifact', id: dosing })).resolves.toBe(true);
    await expect(may(writer, 'edit', { kind: 'artifact', id: dosing })).resolves.toBe(false);
    await expect(may(writer, 'edit', { kind: 'space', id: clinical })).resolves.toBe(true);
  });

  it('gives the readable set that decide gives artifact by artifact, from the stored grants', async () => {
    const { reader, warnings } = await service.withTenant(production, async (trx) => ({
      reader: await principal(trx, 'readable'),
      warnings: await artifact(trx, clinical),
    }));
    await give({
      roleId: roles.Reader!,
      subject: { principal: reader },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
    });
    await give({
      roleId: roles.Reader!,
      subject: { principal: reader },
      level: { kind: 'artifact', id: dosing },
      effect: 'deny',
    });
    await give({
      roleId: roles.Reader!,
      subject: { principal: reader },
      level: { kind: 'artifact', id: audit },
      effect: 'allow',
    });

    const set = await service.withTenant(production, (trx) => loadReadableSet(trx, reader));
    expect(set).toEqual({
      tenant: false,
      spaces: [clinical],
      excluded: [dosing],
      included: [audit],
    });

    const artifacts = await service.withTenant(production, (trx) =>
      trx.selectFrom('artifact').select(['id', 'space_id']).execute(),
    );
    for (const { id, space_id } of artifacts) {
      const contained = space_id === null ? set!.tenant : set!.spaces.includes(space_id);
      const listed = (contained && !set!.excluded.includes(id)) || set!.included.includes(id);
      await expect(may(reader, 'read', { kind: 'artifact', id }), id).resolves.toBe(listed);
    }

    const predicate = await service.withTenant(production, async (trx) => {
      const { rows } = await sql<{ id: string }>`
        select id from artifact
        where ((space_id = any(${set!.spaces}::uuid[]) or (space_id is null and ${set!.tenant}))
          and id <> all(${set!.excluded}::uuid[]))
          or id = any(${set!.included}::uuid[])
        order by id
      `.execute(trx);
      return rows.map((row) => row.id);
    });
    expect(predicate).toEqual([audit, warnings].sort());
  });

  it("reads the true clock rather than the transaction's own start, so a grant that expires while the transaction is open is not read", async () => {
    const soon = await service.withTenant(production, (trx) => principal(trx, 'soon'));
    await give({
      roleId: roles.Reader!,
      subject: { principal: soon },
      level: { kind: 'tenant' },
      effect: 'allow',
      expiresAt: new Date(Date.now() + 300),
    });

    const facts = await service.withTenant(production, async (trx) => {
      // Postgres' own now() would still read the moment the transaction began, well before the
      // grant's expiry; only clock_timestamp(), read after this wait, sees that it has passed.
      await sql`select pg_sleep(1)`.execute(trx);
      return loadFacts(trx, soon, { kind: 'tenant' });
    });
    expect(facts!.grants).toEqual([]);
    expect(decide('read', facts!).allowed).toBe(false);
  });

  it('answers a decision queued behind a change with the clock at the moment it proceeds, not the moment it was asked', async () => {
    const waiting = await service.withTenant(production, (trx) => principal(trx, 'waiting'));
    await give({
      roleId: roles.Reader!,
      subject: { principal: waiting },
      level: { kind: 'tenant' },
      effect: 'allow',
      expiresAt: new Date(Date.now() + 500),
    });

    const holding = latch();
    const release = latch();
    const change = service.withTenant(production, async (trx) => {
      await lockAccessForChange(trx);
      holding.open();
      await release.opened;
    });
    await holding.opened;

    // Queued behind the change's FOR UPDATE lock while the grant's expiry passes for real.
    const decision = service.withTenant(production, (trx) =>
      loadFacts(trx, waiting, { kind: 'tenant' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    release.open();
    await change;

    const facts = await decision;
    expect(facts!.grants).toEqual([]);
    expect(decide('read', facts!).allowed).toBe(false);
  });

  it("loadReadableSet reads the true clock too, not the transaction's own start", async () => {
    const transient = await service.withTenant(production, (trx) => principal(trx, 'transient'));
    await give({
      roleId: roles.Reader!,
      subject: { principal: transient },
      level: { kind: 'tenant' },
      effect: 'allow',
      expiresAt: new Date(Date.now() + 300),
    });

    const set = await service.withTenant(production, async (trx) => {
      await sql`select pg_sleep(1)`.execute(trx);
      return loadReadableSet(trx, transient);
    });
    expect(set).toEqual({ tenant: false, spaces: [], excluded: [], included: [] });
  });

  it("loadReadableSet answers nothing for another tenant's principal, and never lists another tenant's spaces or artifacts", async () => {
    const theirs = await service.withTenant(development, async (trx) => ({
      principal: await principal(trx, 'bob'),
      space: (await createSpace(trx, 'TheirsToo')).id,
      artifact: await artifact(trx, null),
    }));

    await expect(
      service.withTenant(production, (trx) => loadReadableSet(trx, theirs.principal)),
    ).resolves.toBeUndefined();

    const set = await service.withTenant(production, (trx) => loadReadableSet(trx, ada));
    expect(set!.spaces).not.toContain(theirs.space);
    expect(set!.excluded).not.toContain(theirs.artifact);
    expect(set!.included).not.toContain(theirs.artifact);
  });
});
