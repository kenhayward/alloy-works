import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STAND_IN_USERS } from './provider.js';

interface Realm {
  readonly clients: readonly { readonly clientId: string; readonly secret: string }[];
  readonly groups: readonly { readonly name: string }[];
  readonly users: readonly {
    readonly id: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly groups: readonly string[];
  }[];
}

const repo = (path: string) => new URL(`../../../${path}`, import.meta.url);
const realm = JSON.parse(readFileSync(repo('deploy/keycloak/alloy-realm.json'), 'utf8')) as Realm;

// Keycloak stands where the stand-in did, so a stack moving between them keeps its people.
describe('the Keycloak development realm', () => {
  it("holds the stand-in's people, by the same subjects, addresses and groups", () => {
    const people = (each: readonly { id: string; email: string; groups: readonly string[] }[]) =>
      each
        .map(({ id, email, groups }) => ({ id, email, groups }))
        .sort((a, b) => a.id.localeCompare(b.id));
    expect(
      people(
        realm.users.map((user) => ({
          ...user,
          groups: user.groups.map((group) => group.slice(1)),
        })),
      ),
    ).toEqual(people(STAND_IN_USERS.map((user) => ({ ...user, groups: user.groups ?? [] }))));
    expect(realm.users.every((user) => user.emailVerified)).toBe(true);
  });

  it('declares every group its people belong to', () => {
    const declared = realm.groups.map((group) => group.name);
    for (const user of realm.users) {
      for (const group of user.groups) expect(declared).toContain(group.slice(1));
    }
  });

  it('answers to the client the development setup seals', () => {
    const setup = readFileSync(repo('packages/db/src/dev-setup.ts'), 'utf8');
    const client = realm.clients[0];
    expect(setup).toContain(`clientId: '${client?.clientId}'`);
    expect(setup).toContain(`clientSecret: '${client?.secret}'`);
  });
});
