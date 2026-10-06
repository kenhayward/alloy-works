import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { RunAnswer, RunRequest } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { childSpawn, createSupervisor } from './supervisor.js';
import {
  DEV_KEY,
  get,
  httpDraft,
  httpRunRequest,
  httpSettings,
  startFakeApi,
  type FakeApi,
} from './testing/http.js';
import {
  fileDraft,
  keyOf,
  S3_SOURCE_PORT,
  s3RunRequest,
  s3Settings,
  SOURCES_CA,
} from './testing/s3.js';
import {
  column,
  draft,
  LOADED_TIMEOUT_MS,
  PASSWORDS,
  runRequest,
  SEALING_KEY,
  settings,
  suiteChild,
  suiteDeny,
  suiteIsolation,
} from './testing/source.js';
import { TYPED_COLUMNS, TYPED_FILES, typedFormat } from './testing/typed.js';

/**
 * The cross-source fixture (ADR-0035's case 6; the D6 plan, task 3): one table, `sample.typed`, read
 * from PostgreSQL and from each file format over HTTP and over S3, in children of four zones, gives
 * one checksum - the one packages/domain's `canonical.test.ts` pins apart from the code that makes it.
 */
const CASE_6_CHECKSUM = '985fbb2b96898288bbcd686a7cc1cd452d8d1c15280184abcc86b8c2d9c043e2';

const ZONES = ['Pacific/Kiritimati', 'Europe/London', 'America/St_Johns', 'Asia/Kathmandu'];

/** Where each copy of the fixtures lives: the HTTP fake's files, and the S3 source's objects. */
const COPIES = [
  new URL('../../../deploy/sources/http/files/', import.meta.url),
  new URL('../../../deploy/sources/s3/objects/alloy-readings/typed/', import.meta.url),
];

describe('the cross-source fixture', { timeout: LOADED_TIMEOUT_MS }, () => {
  it('is in deploy/sources byte for byte as testing/typed.ts writes it', () => {
    for (const folder of COPIES) {
      for (const [name, write] of Object.entries(TYPED_FILES)) {
        const path = fileURLToPath(new URL(name, folder));
        // ALLOY_WRITE_FIXTURES=1 writes them, once the table or a format's writing changes.
        if (process.env['ALLOY_WRITE_FIXTURES'] === '1') writeFileSync(path, write());
        expect(readFileSync(path).equals(write()), path).toBe(true);
      }
    }
  });

  let api: FakeApi;
  beforeAll(async () => {
    api = await startFakeApi();
  });
  afterAll(async () => {
    await api.close();
  });

  const key = ['k'];
  const order = [{ column: 'k', direction: 'ascending' as const }];

  /** Every run of the table: PostgreSQL's, then each file over HTTP and over S3. */
  function runs(): [string, RunRequest][] {
    const fromPostgres = runRequest(
      settings(),
      PASSWORDS.reader,
      draft(
        `select ${TYPED_COLUMNS.map(([name]) => name).join(', ')} from sample.typed order by k`,
        TYPED_COLUMNS.map(([name, type]) => column(name, type)),
      ),
    );
    const files = Object.keys(TYPED_FILES).flatMap((file): [string, RunRequest][] => {
      const { format, columns } = typedFormat(file);
      return [
        [
          `${file} over HTTP`,
          httpRunRequest(
            httpSettings(api.port),
            DEV_KEY,
            httpDraft(get(['files', file]), columns, { format, key, order }),
          ),
        ],
        [
          `${file} over S3`,
          s3RunRequest(
            s3Settings(S3_SOURCE_PORT),
            fileDraft(keyOf(`typed/${file}`), columns, { format, key, order }),
          ),
        ],
      ];
    });
    return [['PostgreSQL', fromPostgres], ...files];
  }

  it('DAT-074 reads one table to one checksum from a relational database, and from CSV, XLSX, JSON and JSON Lines over an HTTP endpoint and from S3-compatible storage, in four zones', async () => {
    const seen: Record<string, string[]> = {};
    for (const zone of ZONES) {
      // A child whose own zone is this one: nothing of a value may pass through it.
      const supervisor = createSupervisor({
        sealingKey: SEALING_KEY,
        deny: suiteDeny,
        maxChildren: 8,
        spec: { ...childSpawn(suiteChild, suiteIsolation), env: { TZ: zone } },
        ca: SOURCES_CA,
      });
      // Four at a time, as many runs as the connector runs at once.
      const all = runs();
      const answers: (readonly [string, RunAnswer | 'busy'])[] = [];
      for (let at = 0; at < all.length; at += 4) {
        answers.push(
          ...(await Promise.all(
            all
              .slice(at, at + 4)
              .map(
                async ([name, request]) => [name, await supervisor.run('run', request)] as const,
              ),
          )),
        );
      }
      for (const [name, answer] of answers) {
        const ran = answer as RunAnswer;
        expect(
          ran.outcome === 'ok' ? ran.checksum : JSON.stringify(ran),
          `${name} in ${zone}`,
        ).toBe(CASE_6_CHECKSUM);
        (seen[name] ??= []).push(zone);
      }
    }
    // Nine reads - PostgreSQL's, and four formats over two transports - in each of the four zones.
    expect(Object.keys(seen)).toHaveLength(9);
    expect(Object.values(seen).every((zones) => zones.length === ZONES.length)).toBe(true);
  });
});
