import { randomUUID } from 'node:crypto';
import {
  canonicalise,
  parseContentDocument,
  type ComponentSubstance,
  type ComponentTypeDefinition,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from '../bootstrap.js';
import { migrate } from '../migrate.js';
import { createTenant, type Tenant } from '../provision.js';
import { createTenantDatabase, type TenantDatabase } from '../tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '../testing/database.js';
import { versionDigests } from '../version-digest.js';
import {
  generateContent,
  logUniform,
  pick,
  seeded,
  uniformInt,
  type SizeClass,
  type VersionCountClass,
} from './generate.js';

/*
 * Whether inline JSONB holds up at authoring volume (storage-and-versioning.md, open questions).
 * Every number below is an assumption stated in docs/plans/2026-09-15-storage-01-the-version-chain.md,
 * decision 9, and each can be changed there and here together.
 */
const COMPONENTS = Number(process.env.ALLOY_LOAD_COMPONENTS ?? 20_000);
const MILLION = 1_000_000; // REL-031 and SCH-033 state their budgets for a tenant of a million components

const SIZES: readonly SizeClass[] = [
  { name: 'small, 0.5-4 KB', share: 0.7, min: 500, max: 4_000 },
  { name: 'medium, 4-32 KB', share: 0.25, min: 4_000, max: 32_000 },
  { name: 'large, 32-128 KB', share: 0.045, min: 32_000, max: 128_000 },
  { name: 'very large, 128 KB-1 MB', share: 0.005, min: 128_000, max: 1_000_000 },
];
const VERSION_COUNTS: readonly VersionCountClass[] = [
  { share: 0.4, min: 1, max: 2 },
  { share: 0.35, min: 3, max: 6 },
  { share: 0.2, min: 7, max: 15 },
  { share: 0.05, min: 16, max: 40 },
];
/** Of the versions after the first, the share that change metadata and leave content alone. */
const METADATA_ONLY = 0.2;
/** Components one 300-page document assembles (PUB-064), at three a page. */
const DOCUMENT_COMPONENTS = 900;

const THRESHOLDS = {
  cutP95: 50,
  openP95: 50,
  anyMax: 500,
  documentP95: 1_000,
  digestsP95: 100,
  projectedGigabytes: 250,
};

interface Seeded {
  readonly artifactId: string;
  readonly size: SizeClass;
  latest: { id: string; versionNo: number; digest: string };
}

const percentile = (samples: readonly number[], p: number) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};

const summary = (samples: readonly number[]) => ({
  n: samples.length,
  p50: Number(percentile(samples, 50).toFixed(2)),
  p95: Number(percentile(samples, 95).toFixed(2)),
  p99: Number(percentile(samples, 99).toFixed(2)),
  max: Number(Math.max(...samples).toFixed(2)),
});

describe('inline JSONB at authoring volume', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let author: string;
  let typeArtifact: string;
  let typeVersion: string;
  const components: Seeded[] = [];
  const report: Record<string, unknown> = {};
  const random = seeded(20260915);

  const valuesFor = (component: number, version: number) => ({
    'field-study': `S-${component}`,
    'field-dose': `${version}.5`,
    'field-date': '2026-09-15',
    'field-owner': { user: author },
    'field-sites': ['Leeds', 'York', `Site ${version}`],
  });

  const substance = (content: ComponentSubstance['content'], values: Record<string, unknown>) =>
    ({
      kind: 'component',
      content,
      values,
      notCarried: [],
      definitions: [{ kind: 'componentType', id: typeArtifact, version: typeVersion }],
    }) satisfies ComponentSubstance;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Load' },
      hostnames: ['load.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl, { max: 2 });

    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    const schema = admin.escapeIdentifier(tenant.schema);
    const started = performance.now();
    let rawBytes = 0;
    let versions = 0;
    try {
      author = (
        await admin.query<{ id: string }>(
          `insert into ${schema}.principal (issuer, subject, display_name) values ('https://idp.example', 'ada', 'Ada') returning id`,
        )
      ).rows[0]!.id;
      const space = (
        await admin.query<{ id: string }>(
          `insert into ${schema}.space (name) values ('Load') returning id`,
        )
      ).rows[0]!.id;
      typeArtifact = randomUUID();
      const typeContent: ComponentTypeDefinition = {
        schemaVersion: 1,
        id: typeArtifact,
        name: 'Protocol',
        assignments: [],
      };
      await admin.query(`insert into ${schema}.artifact (id, kind) values ($1, 'componentType')`, [
        typeArtifact,
      ]);
      const typeDigests = versionDigests({ kind: 'componentType', content: typeContent });
      typeVersion = (
        await admin.query<{ id: string }>(
          `insert into ${schema}.artifact_version (artifact_id, kind, revision_no, version_no, author_id,
             schema_version, content, content_hash, metadata_values, not_carried, version_digest)
           values ($1, 'componentType', 0, 1, $2, 1, $3, $4, '{}', '[]', $5) returning id`,
          [
            typeArtifact,
            author,
            JSON.stringify(typeContent),
            typeDigests.contentHash,
            typeDigests.versionDigest,
          ],
        )
      ).rows[0]!.id;

      const columns =
        'id, artifact_id, kind, revision_no, version_no, author_id, schema_version, content, content_hash, metadata_values, not_carried, component_type_version_id, version_digest';
      let artifactRows: unknown[][] = [];
      let versionRows: unknown[][] = [];
      let batchBytes = 0;
      // One transaction a batch: a component version's type is checked against its recorded
      // definitions at commit, so the two go in together.
      const flush = async () => {
        await admin.query('begin');
        if (artifactRows.length > 0) {
          await admin.query(
            `insert into ${schema}.artifact (id, kind, space_id) values ${artifactRows
              .map((_, index) => `($${index * 2 + 1}, 'component', $${index * 2 + 2})`)
              .join(',')}`,
            artifactRows.flat(),
          );
        }
        if (versionRows.length > 0) {
          const width = 13;
          await admin.query(
            `insert into ${schema}.artifact_version (${columns}) values ${versionRows
              .map(
                (_, row) =>
                  `(${Array.from({ length: width }, (_, column) => `$${row * width + column + 1}`).join(',')})`,
              )
              .join(',')}`,
            versionRows.flat(),
          );
          await admin.query(
            `insert into ${schema}.version_definition (version_id, definition_version_id, definition_artifact_id, definition_kind)
             select id, $1, $2, 'componentType' from unnest($3::uuid[]) as id`,
            [typeVersion, typeArtifact, versionRows.map((row) => row[0])],
          );
        }
        await admin.query('commit');
        artifactRows = [];
        versionRows = [];
        batchBytes = 0;
      };

      for (let index = 0; index < COMPONENTS; index += 1) {
        const artifactId = randomUUID();
        const size = pick(SIZES, random);
        const count = uniformInt(
          ...(({ min, max }) => [min, max] as const)(pick(VERSION_COUNTS, random)),
          random,
        );
        artifactRows.push([artifactId, space]);
        let content = generateContent(logUniform(size.min, size.max, random), random);
        let latest = { id: '', versionNo: 0, digest: '' };
        for (let versionNo = 1; versionNo <= count; versionNo += 1) {
          if (versionNo > 1 && random() >= METADATA_ONLY) {
            content = generateContent(logUniform(size.min, size.max, random), random);
          }
          const record = substance(content, valuesFor(index, versionNo));
          const digests = versionDigests(record);
          const json = JSON.stringify(content);
          const id = randomUUID();
          versionRows.push([
            id,
            artifactId,
            'component',
            0,
            versionNo,
            author,
            1,
            json,
            digests.contentHash,
            JSON.stringify(record.values),
            '[]',
            typeVersion,
            digests.versionDigest,
          ]);
          latest = { id, versionNo, digest: digests.versionDigest };
          rawBytes += json.length;
          batchBytes += json.length;
          versions += 1;
          if (batchBytes > 8_000_000 || versionRows.length >= 2_000) await flush();
        }
        components.push({ artifactId, size, latest });
      }
      await flush();
      await admin.query(`vacuum analyze ${schema}.artifact_version`);
      await admin.query(`vacuum analyze ${schema}.version_definition`);

      const sizes = (
        await admin.query<{ heap: string; toast: string; indexes: string; total: string }>(
          `select pg_relation_size(c.oid) as heap,
                  coalesce(pg_total_relation_size(c.reltoastrelid), 0) as toast,
                  pg_indexes_size(c.oid) as indexes,
                  pg_total_relation_size(c.oid) as total
           from pg_class c where c.oid = $1::regclass`,
          [`${tenant.schema}.artifact_version`],
        )
      ).rows[0]!;
      const total =
        Number(sizes.total) +
        Number(
          (
            await admin.query<{ total: string }>(
              `select pg_total_relation_size($1::regclass) as total`,
              [`${tenant.schema}.version_definition`],
            )
          ).rows[0]!.total,
        );
      const perVersion = total / (versions + 1);
      report.seed = {
        components: COMPONENTS,
        versions,
        meanVersionsPerComponent: Number((versions / COMPONENTS).toFixed(2)),
        rawContentMegabytes: Number((rawBytes / 1e6).toFixed(1)),
        meanContentKilobytes: Number((rawBytes / versions / 1e3).toFixed(2)),
        seconds: Number(((performance.now() - started) / 1e3).toFixed(1)),
      };
      report.storage = {
        heapMegabytes: Number((Number(sizes.heap) / 1e6).toFixed(1)),
        toastMegabytes: Number((Number(sizes.toast) / 1e6).toFixed(1)),
        indexMegabytes: Number((Number(sizes.indexes) / 1e6).toFixed(1)),
        chainMegabytes: Number((total / 1e6).toFixed(1)),
        bytesPerVersion: Math.round(perVersion),
        onDiskOverRawContent: Number((total / rawBytes).toFixed(3)),
        projectedGigabytesAtAMillionComponents: Number(
          ((perVersion * (versions / COMPONENTS) * MILLION) / 1e9).toFixed(1),
        ),
      };
    } finally {
      await admin.end();
    }
  }, 3_600_000);

  afterAll(async () => {
    console.info(`Version chain load report\n${JSON.stringify(report, null, 2)}`);
    await service?.close();
    await db?.drop();
  });

  const sample = (count: number) =>
    Array.from({ length: count }, () => components[Math.floor(random() * components.length)]!);

  it('cuts a version: lock, read the latest, insert the version and its definition', async () => {
    const byClass = new Map<string, number[]>();
    const all: number[] = [];
    const targets = sample(550);
    for (const [index, component] of targets.entries()) {
      const content = parseContentDocument(
        generateContent(logUniform(component.size.min, component.size.max, random), random),
      );
      const record = substance(content, valuesFor(index, component.latest.versionNo + 1));
      const digests = versionDigests(record);
      const started = performance.now();
      const inserted = await service.withTenant(tenant, async (trx) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:artifact:${component.artifactId}`}, 0))`.execute(
          trx,
        );
        const latest = await trx
          .selectFrom('artifact_version')
          .select(['id', 'revision_no', 'version_no', 'version_digest'])
          .where('artifact_id', '=', component.artifactId)
          .orderBy('revision_no', 'desc')
          .orderBy('version_no', 'desc')
          .limit(1)
          .executeTakeFirstOrThrow();
        const row = await trx
          .insertInto('artifact_version')
          .values({
            artifact_id: component.artifactId,
            kind: 'component',
            revision_no: latest.revision_no,
            version_no: latest.version_no + 1,
            author_id: author,
            note: null,
            schema_version: 1,
            content: JSON.stringify(content),
            content_hash: digests.contentHash,
            metadata_values: JSON.stringify(record.values),
            not_carried: '[]',
            component_type_version_id: typeVersion,
            version_digest: digests.versionDigest,
          })
          .returning(['id', 'version_no'])
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('version_definition')
          .values({
            version_id: row.id,
            definition_version_id: typeVersion,
            definition_artifact_id: typeArtifact,
            definition_kind: 'componentType',
          })
          .execute();
        return row;
      });
      const elapsed = performance.now() - started;
      component.latest = {
        id: inserted.id,
        versionNo: inserted.version_no,
        digest: digests.versionDigest,
      };
      if (index < 50) continue; // warm-up
      all.push(elapsed);
      byClass.set(component.size.name, [...(byClass.get(component.size.name) ?? []), elapsed]);
    }
    report.cut = {
      all: summary(all),
      bySize: Object.fromEntries([...byClass].map(([name, samples]) => [name, summary(samples)])),
    };
    expect(percentile(all, 95)).toBeLessThanOrEqual(THRESHOLDS.cutP95);
    expect(Math.max(...all)).toBeLessThanOrEqual(THRESHOLDS.anyMax);
  }, 600_000);

  it('opens a component: its latest version, content and values', async () => {
    const all: number[] = [];
    for (const [index, component] of sample(1_050).entries()) {
      const started = performance.now();
      const row = await service.withTenant(tenant, (trx) =>
        trx
          .selectFrom('artifact_version')
          .selectAll()
          .where('artifact_id', '=', component.artifactId)
          .orderBy('revision_no', 'desc')
          .orderBy('version_no', 'desc')
          .limit(1)
          .executeTakeFirstOrThrow(),
      );
      const elapsed = performance.now() - started;
      expect(row.version_digest).toBe(component.latest.digest);
      if (index >= 50) all.push(elapsed);
    }
    report.open = summary(all);
    expect(percentile(all, 95)).toBeLessThanOrEqual(THRESHOLDS.openP95);
    expect(Math.max(...all)).toBeLessThanOrEqual(THRESHOLDS.anyMax);
  }, 600_000);

  it("reads one 300-page document's worth of content in one query", async () => {
    const all: number[] = [];
    for (let round = 0; round < 23; round += 1) {
      const ids = sample(DOCUMENT_COMPONENTS).map((component) => component.latest.id);
      const started = performance.now();
      const rows = await service.withTenant(tenant, (trx) =>
        trx
          .selectFrom('artifact_version')
          .select(['id', 'content', 'metadata_values'])
          .where('id', 'in', ids)
          .execute(),
      );
      const elapsed = performance.now() - started;
      expect(rows.length).toBe(new Set(ids).size);
      if (round >= 3) all.push(elapsed);
    }
    report.document = summary(all);
    expect(percentile(all, 95)).toBeLessThanOrEqual(THRESHOLDS.documentP95);
  }, 600_000);

  it("reads the same document's digests without its content", async () => {
    const all: number[] = [];
    for (let round = 0; round < 53; round += 1) {
      const ids = sample(DOCUMENT_COMPONENTS).map((component) => component.latest.id);
      const started = performance.now();
      await service.withTenant(tenant, (trx) =>
        trx
          .selectFrom('artifact_version')
          .select(['id', 'version_digest', 'content_hash'])
          .where('id', 'in', ids)
          .execute(),
      );
      if (round >= 3) all.push(performance.now() - started);
    }
    report.digests = summary(all);
    expect(percentile(all, 95)).toBeLessThanOrEqual(THRESHOLDS.digestsP95);
  }, 600_000);

  it('projects the chain for a tenant of a million components', () => {
    const storage = report.storage as { projectedGigabytesAtAMillionComponents: number };
    expect(storage.projectedGigabytesAtAMillionComponents).toBeLessThanOrEqual(
      THRESHOLDS.projectedGigabytes,
    );
    // The canonical form is what is hashed, not what is stored; a sanity check that they agree.
    expect(canonicalise(generateContent(2_000, seeded(1)))).toContain('"schemaVersion":1');
  });
});
