import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  SECRET_CONSUMER_KINDS,
  SECRET_CONSUMERS,
  SECRET_EXCLUSIONS,
  SECRET_KINDS,
  SECRET_OVERLAP_HOURS,
} from './consumers.js';

const migrations = new URL('../../../db/migrations/', import.meta.url);

/** Every `table.column` a migration makes whose name says it is sealed or a token's hash. */
function sealedColumns(): Set<string> {
  const found = new Set<string>();
  for (const folder of ['platform', 'tenant']) {
    const dir = new URL(`${folder}/`, migrations);
    for (const file of readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      let table: string | undefined;
      for (const line of readFileSync(new URL(file, dir), 'utf8').split(/\r?\n/)) {
        const code = line.replace(/--.*$/, '');
        const opened = /\b(?:create|alter) table (?:if not exists )?(?:only )?([a-z_]+)/i.exec(
          code,
        );
        if (opened) table = opened[1];
        const column =
          /^\s*(?:add column (?:if not exists )?)?(sealed[a-z_]*|token_hash)\s+text\b/i.exec(
            code.replace(/^\s*alter table [a-z_]+\s+/i, ''),
          );
        if (column && table) found.add(`${table}.${column[1]}`);
      }
    }
  }
  return found;
}

describe('a tenant’s secrets and what consumes each (secrets.md)', () => {
  it('names one row per kind of secret, each with what reads it and its consumers', () => {
    expect(SECRET_CONSUMERS.map((each) => each.kind)).toEqual([...SECRET_KINDS]);
    for (const each of SECRET_CONSUMERS) {
      expect(each.consumers.length, each.kind).toBeGreaterThan(0);
      for (const consumer of each.consumers) expect(SECRET_CONSUMER_KINDS).toContain(consumer);
      expect(each.readBy.length, each.kind).toBeGreaterThan(0);
    }
  });

  it('holds a row to every sealed or hashed column the migrations make, or names why not', () => {
    const named = new Set([
      ...SECRET_CONSUMERS.flatMap((each) => each.stored),
      ...SECRET_EXCLUSIONS.map((each) => each.stored),
    ]);
    const found = sealedColumns();
    // The scan finds what it should, so an empty one cannot pass.
    expect(found).toContain('webhook_subscription.sealed');
    expect(found).toContain('api_token.token_hash');
    expect([...found].filter((column) => !named.has(column)).sort()).toEqual([]);
    expect([...named].filter((column) => !found.has(column)).sort()).toEqual([]);
  });

  it("ADM-007 names the operator's object store credential as no tenant's to replace", () => {
    expect(SECRET_EXCLUSIONS.map((each) => each.stored)).toContain(
      'object_store_credential.sealed_secret',
    );
  });

  it('ADM-007 replaces every token held outside with an overlap, and every other value at once', () => {
    const how = Object.fromEntries(
      SECRET_CONSUMERS.map((each) => [each.kind, each.replacement.how]),
    );
    expect(how).toEqual({
      sign_in_client_secret: 'atomic',
      shared_provider_secret: 'atomic',
      connection_credential: 'atomic',
      delivery_store_password: 'atomic',
      model_endpoint_key: 'atomic',
      webhook_signing_secret: 'overlap',
      extension_secret: 'atomic',
      mail_relay_password: 'atomic',
      scim_token: 'overlap',
      ct_studio_token: 'overlap',
      service_identity_token: 'beside',
    });
    for (const each of SECRET_CONSUMERS) {
      if (each.replacement.how === 'overlap') {
        expect(each.replacement.hours).toBe(SECRET_OVERLAP_HOURS);
      }
    }
    expect(SECRET_OVERLAP_HOURS).toBe(24);
  });
});
