// Shared config and helpers for the case harnesses, run from the host against the published caller
// (placement A) and connector (placement C) control APIs. All values are the stack's invented,
// fake development values.
import { sealSecret } from './lib/seal.mjs';

export const SEALING_KEY_B64 = 'dlBCBJkzSuecCoSn76qngagHLR5Qjg5YHBMawT+ReJ0=';
export const CALLER = 'http://127.0.0.1:15706';
export const CONNECTOR = 'http://127.0.0.1:15707';

// Internal addresses (static IPs from compose.yaml).
export const ADDR = {
  platformPg: '172.31.10.11',
  seaweed: '172.31.10.12',
  metadata: '172.31.10.13',
  idp: '172.31.10.14',
  callerPlatform: '172.31.10.10',
  sourcePg: '172.31.20.21',
  sqlserver: '172.31.20.22',
  fakeApi: '172.31.20.23',
  tokenExchange: '172.31.20.24',
  resolver: '172.31.20.25',
};

// Seal a secret for a tenant the way the product seals its object-store/sign-in secrets.
export function seal(tenantId, secret) {
  const key = Buffer.from(SEALING_KEY_B64, 'base64');
  return sealSecret(key, 'connection', tenantId, secret);
}

// A ready-made spec per source. tenantId scopes the seal; sealingKey travels in the spec only
// because the harness runs outside the agent (a phase-1 simplification, noted in the findings).
export function pgSpec(tenantId = 'tenant-ada') {
  return {
    kind: 'postgres',
    host: 'source-pg',
    port: 5432,
    database: 'sourcedb',
    user: 'connector_login',
    tenantId,
    sealingKey: SEALING_KEY_B64,
    sealedSecret: seal(tenantId, 'source-pg-connector-fake-pw'),
    testSql: 'select 1 as one',
  };
}
export function mssqlSpec(tenantId = 'tenant-ada') {
  return {
    kind: 'sqlserver',
    host: 'sqlserver',
    port: 1433,
    database: 'sourcedb',
    user: 'sa',
    encrypt: true,
    trustServerCertificate: true,
    tenantId,
    sealingKey: SEALING_KEY_B64,
    sealedSecret: seal(tenantId, 'Spike-SqlServer-Fake-Pw1'),
    testSql: 'select 1 as one',
  };
}
export function httpSpec(tenantId = 'tenant-ada') {
  return {
    kind: 'http',
    host: 'fake-api',
    url: 'http://fake-api/',
    tenantId,
    sealingKey: SEALING_KEY_B64,
    sealedSecret: seal(tenantId, 'fake-api-bearer-token-for-the-spike'),
  };
}

export async function post(base, path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, text };
  }
}
