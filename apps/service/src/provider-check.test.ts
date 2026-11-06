import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  issueApiToken,
  listenToTenants,
  migrate,
  openSecret,
  type Tenant,
  type TenantDatabase,
  type TenantEvent,
} from '@alloy-works/db';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderToken, type ProviderAnswer, type ProviderSettings } from './oidc.js';
import {
  checkAtProvider,
  createSession,
  hashToken,
  markReauthenticated,
  PROVIDER_CHECK_INTERVAL_MS,
  sessionHeld,
  type HeldSession,
} from './sessions.js';

const KEY = Buffer.alloc(32, 9);
const SETTINGS: ProviderSettings = {
  issuer: 'https://idp.example',
  clientId: 'alloy',
  clientSecret: 'not-asked',
  offlineAccess: true,
};

/** A provider played by hand: each answer in turn, and what it was asked with. */
function fakeProvider(...answers: (ProviderAnswer | (() => Promise<ProviderAnswer>))[]) {
  const asked: string[] = [];
  return {
    asked,
    oidc: {
      async refresh(_provider: ProviderSettings, token: ProviderToken): Promise<ProviderAnswer> {
        asked.push(token.reveal());
        const next = answers.shift();
        if (next === undefined) throw new Error('asked more often than expected');
        return typeof next === 'function' ? next() : next;
      },
    },
  };
}

describe('a session asked again at its provider (the PC plan)', () => {
  let db: TestDatabase;
  let acme: Tenant;
  let globex: Tenant;
  let seeding: TenantDatabase;
  // No audit context of its own, as the service's has none: an ending must name its actor.
  let service: TenantDatabase;
  const providers = new Map<string, string>();

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    for (const [id, host] of [
      ['acme', 'acme.alloy.test'],
      ['globex', 'globex.alloy.test'],
    ] as const) {
      const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
        organisation: { id, name: id },
        tenant: { id: db.newTenantId(), name: 'Production' },
        hostnames: [host],
      });
      if (id === 'acme') acme = tenant;
      else globex = tenant;
      providers.set(
        tenant.id,
        await configureOrganisationSignIn(
          db.adminUrl,
          tenant,
          { issuer: `https://idp.${id}.example`, clientId: 'alloy', clientSecret: 'secret' },
          KEY,
        ),
      );
    }
    seeding = testTenantDatabase(db.serviceUrl);
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await seeding.close();
    await service.close();
    await db.drop();
  });

  const at = (ms: number) => new Date(Date.UTC(2026, 10, 6) + ms);
  const due = PROVIDER_CHECK_INTERVAL_MS + 1;

  /** Ada, or another, signed in through the tenant's provider with a token kept, at `at(0)`. */
  async function signedIn(tenant: Tenant, refresh = 'refresh-1', subject = 'ada') {
    return seeding.withTenant(tenant, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: `${subject}-${Math.random()}` })
        .returning('id')
        .executeTakeFirstOrThrow();
      const token = await createSession(
        trx,
        principal.id,
        'organisation',
        at(0),
        providers.get(tenant.id)!,
        { token: new ProviderToken(refresh), sealingKey: KEY, tenantId: tenant.id },
      );
      const held = (await sessionHeld(trx, token, at(0)))!;
      return { token, held, principalId: principal.id };
    });
  }

  const check = (
    tenant: Tenant,
    held: HeldSession,
    oidc: ReturnType<typeof fakeProvider>['oidc'],
    now: Date,
    provider: (id: string) => Promise<ProviderSettings | undefined> = async () => SETTINGS,
  ) => checkAtProvider({ db: service, sealingKey: KEY, provider, oidc }, tenant, held, now);

  const row = async (tenant: Tenant, id: string) =>
    (
      await queryAs(
        db.adminUrl,
        `select sealed_refresh, provider_checked_at from ${tenant.schema}.session where id = $1`,
        [id],
      )
    ).rows[0] as { sealed_refresh: string; provider_checked_at: Date } | undefined;

  it('keeps the token sealed to the tenant and the session, and the sign-in as its first check', async () => {
    const { held } = await signedIn(acme, 'refresh-sealed');
    const kept = (await row(acme, held.id))!;
    expect(kept.sealed_refresh).toMatch(/^v1\./);
    expect(kept.sealed_refresh).not.toContain('refresh-sealed');
    expect(openSecret(KEY, 'session-refresh', acme.id, kept.sealed_refresh, held.id)).toBe(
      'refresh-sealed',
    );
    expect(kept.provider_checked_at).toEqual(at(0));
  });

  it('asks nobody before the interval, and asks once it has passed', async () => {
    const { held } = await signedIn(acme);
    const provider = fakeProvider({ outcome: 'renewed', token: new ProviderToken('refresh-1') });
    expect(await check(acme, held, provider.oidc, at(PROVIDER_CHECK_INTERVAL_MS - 1))).toBe(
      'not_due',
    );
    expect(provider.asked).toEqual([]);
    expect(await check(acme, held, provider.oidc, at(due))).toBe('signed_in');
    expect(provider.asked).toEqual(['refresh-1']);
    expect(PROVIDER_CHECK_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it('IAM-010 ends the session the provider refuses, as a system sign-out, with its tokens, and says so to every replica', async () => {
    const { token, held, principalId } = await signedIn(acme);
    const secret = 'an-api-token-secret';
    const issued = await seeding.withTenant(acme, (trx) =>
      issueApiToken(trx, {
        principalId,
        name: 'Scripts',
        tokenHash: hashToken(secret),
        scopes: ['edit'],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }),
    );
    const heard: TenantEvent[] = [];
    const listener = listenToTenants(db.serviceUrl);
    const subscription = listener.subscribe(acme.id, (event) => heard.push(event));
    await subscription.ready;
    try {
      const provider = fakeProvider({ outcome: 'refused' });
      expect(await check(acme, held, provider.oidc, at(due))).toBe('ended');
      expect(
        await seeding.withTenant(acme, (trx) => sessionHeld(trx, token, at(due))),
      ).toBeUndefined();
      const left = await queryAs(
        db.adminUrl,
        `select id from ${acme.schema}.api_token where principal_id = $1`,
        [principalId],
      );
      expect(left.rows).toEqual([]);
      const events = await queryAs(
        db.adminUrl,
        `select kind, actor_kind, detail from ${acme.schema}.audit_event
         where kind in ('authentication.signed_out', 'token.revoked') and subject in ($1, $2)
         order by kind`,
        [principalId, issued.id],
      );
      expect(events.rows).toEqual([
        {
          kind: 'authentication.signed_out',
          actor_kind: 'system',
          detail: { ended: 'provider_refused', session: held.id },
        },
        { kind: 'token.revoked', actor_kind: 'system', detail: {} },
      ]);
      await expect
        .poll(() => heard)
        .toEqual(
          expect.arrayContaining([
            { kind: 'credential_ended', session: held.id },
            { kind: 'credential_ended', token: issued.id },
          ]),
        );
    } finally {
      subscription.stop();
      await listener.close();
    }
  });

  it('keeps the token the provider rotates, sealed, and asks with it next time', async () => {
    const { held } = await signedIn(acme, 'refresh-old');
    const provider = fakeProvider(
      { outcome: 'renewed', token: new ProviderToken('refresh-new') },
      { outcome: 'renewed', token: new ProviderToken('refresh-new') },
    );
    expect(await check(acme, held, provider.oidc, at(due))).toBe('signed_in');
    const kept = (await row(acme, held.id))!;
    expect(openSecret(KEY, 'session-refresh', acme.id, kept.sealed_refresh, held.id)).toBe(
      'refresh-new',
    );
    expect(kept.provider_checked_at).toEqual(at(due));
    expect(await check(acme, held, provider.oidc, at(2 * due))).toBe('signed_in');
    expect(provider.asked).toEqual(['refresh-old', 'refresh-new']);
  });

  it('keeps the session going when the provider is unreachable or does not answer in time, and asks again at the next interval', async () => {
    const { token, held } = await signedIn(acme);
    const provider = fakeProvider({ outcome: 'unanswered' }, { outcome: 'refused' });
    expect(await check(acme, held, provider.oidc, at(due))).toBe('not_asked');
    expect(await seeding.withTenant(acme, (trx) => sessionHeld(trx, token, at(due)))).toBeDefined();
    expect(await check(acme, held, provider.oidc, at(due + 1000))).toBe('not_due');
    expect(await check(acme, held, provider.oidc, at(2 * due))).toBe('ended');
  });

  it('asks once when two replicas find it due together', async () => {
    const { held } = await signedIn(acme);
    let answer!: (value: ProviderAnswer) => void;
    const provider = fakeProvider(
      () =>
        new Promise<ProviderAnswer>((resolve) => {
          answer = resolve;
        }),
    );
    const first = check(acme, held, provider.oidc, at(due));
    const second = check(acme, held, provider.oidc, at(due));
    expect(await second).toBe('not_due');
    answer({ outcome: 'renewed', token: new ProviderToken('refresh-1') });
    expect(await first).toBe('signed_in');
    expect(provider.asked).toHaveLength(1);
  });

  it('does not end a session re-authenticated while the provider was being asked', async () => {
    const { token, held } = await signedIn(acme, 'refresh-before');
    const provider = fakeProvider(async () => {
      await seeding.withTenant(acme, (trx) =>
        markReauthenticated(trx, { ...held, principalId: held.principal.principalId }, at(due), {
          token: new ProviderToken('refresh-after'),
          sealingKey: KEY,
          tenantId: acme.id,
        }),
      );
      return { outcome: 'refused' };
    });
    expect(await check(acme, held, provider.oidc, at(due))).toBe('signed_in');
    expect(await seeding.withTenant(acme, (trx) => sessionHeld(trx, token, at(due)))).toBeDefined();
    const kept = (await row(acme, held.id))!;
    expect(openSecret(KEY, 'session-refresh', acme.id, kept.sealed_refresh, held.id)).toBe(
      'refresh-after',
    );
  });

  it('asks nothing of a provider closed or unreadable, and keeps the session: that is not a refusal', async () => {
    const { token, held } = await signedIn(acme);
    const provider = fakeProvider();
    expect(await check(acme, held, provider.oidc, at(due), async () => undefined)).toBe(
      'not_asked',
    );
    expect(provider.asked).toEqual([]);
    expect(await seeding.withTenant(acme, (trx) => sessionHeld(trx, token, at(due)))).toBeDefined();
  });

  it("IAM-075 never asks with another tenant's token, or another session's, copied into a row", async () => {
    const theirs = await signedIn(acme, 'acme-refresh');
    const ours = await signedIn(globex, 'globex-refresh');
    const sibling = await signedIn(globex, 'sibling-refresh');
    const copied = (await row(acme, theirs.held.id))!.sealed_refresh;
    const own = (await row(globex, sibling.held.id))!.sealed_refresh;
    const provider = fakeProvider();
    for (const sealed of [copied, own]) {
      await queryAs(
        db.adminUrl,
        `update ${globex.schema}.session set sealed_refresh = $2, provider_checked_at = $3 where id = $1`,
        [ours.held.id, sealed, at(0)],
      );
      expect(await check(globex, ours.held, provider.oidc, at(due))).toBe('not_asked');
    }
    expect(provider.asked).toEqual([]);
  });

  it('asks nothing for a session that kept no token, as a Google one keeps none', async () => {
    const google = await seeding.withTenant(acme, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({ issuer: 'https://accounts.google.com', subject: `g-${Math.random()}` })
        .returning('id')
        .executeTakeFirstOrThrow();
      const token = await createSession(trx, principal.id, 'google', at(0));
      return (await sessionHeld(trx, token, at(0)))!;
    });
    const provider = fakeProvider();
    expect(await check(acme, google, provider.oidc, at(due))).toBe('not_due');
    expect((await row(acme, google.id))!.sealed_refresh).toBeNull();
  });
});
