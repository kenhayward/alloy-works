import { crc32, deflateSync } from 'node:zlib';
import {
  pendingResult,
  readPendingResult,
  readQueryDefinition,
  recordAsset,
  refuseAssetUpload,
  removeGrant,
  uploadForDatasetImage,
} from '@alloy-works/db';
import { holdingAdvisoryLock, queryAs, untilWaitingOnLocks } from '@alloy-works/db/testing';
import {
  canonicalResultBytes,
  readImageHeader,
  type CanonicalValue,
  type RunAnswer,
} from '@alloy-works/domain';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantPrefix } from '@alloy-works/objects';
import { binding, sha256, startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** An invented PNG, decodable: RGB, eight bits, every pixel one shade, `width` telling them apart. */
const png = (width: number) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(2, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 90)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat([row, row]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
const hashOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** A definition's columns with a photograph: a site's id, its name and its picture. */
const PHOTO_COLUMNS = [
  { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
  { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
  {
    name: 'photo',
    from: { column: 'photo' },
    type: { base: 'image', encoding: 'binary', description: 'decorative' },
  },
];

/** A run's answer holding these rows, each with a photograph, and each image carried once. */
const ranWithImages = (rows: [string, string | null, Buffer | null][]): RunAnswer => {
  const result = {
    columns: [
      ['id', 'integer'],
      ['name', 'text'],
      ['photo', 'image'],
    ] as [string, 'integer' | 'text' | 'image'][],
    rows: rows.map(([id, name, image]): CanonicalValue[] => [
      id,
      name,
      image === null ? null : hashOf(image),
    ]),
  };
  return {
    outcome: 'ok',
    result,
    checksum: sha256(canonicalResultBytes(result)),
    rowCount: rows.length,
    ran: { sql: 'select id, name, photo from sample.site where id = $1::int8 order by id' },
    durationMs: 12,
    images: Object.fromEntries(
      rows.flatMap(([, , image]) =>
        image === null ? [] : [[hashOf(image), image.toString('base64')]],
      ),
    ),
  };
};

interface Pending {
  id: string;
  act: string;
  state: 'pending' | 'done';
  result: (Json & { held?: Json; failure?: Json }) | null;
}

describe("a result's images, admitted before it is kept (the D8 plan, D8-D and D8-E)", () => {
  let h: Harness;
  let connection: { id: string; version: string };
  let definition: { id: string; version: string };
  let site = 100;

  beforeAll(async () => {
    h = await startHarness();
    connection = await h.connection('Readings');
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
    definition = await h.definition(connection.id, { columns: PHOTO_COLUMNS });
  });

  afterAll(async () => {
    await h?.close();
  });

  /** A document placing a component holding one binding of the photograph definition, at a new site. */
  const placed = async (id = 'b1') => {
    site += 1;
    const component = await h.component(h.general, 'Sites');
    await h.place(
      component,
      binding(id, definition.id, { parameters: { site: { literal: String(site) } } }),
    );
    const document = await h.documentReferencing([component.id]);
    return { component, document, node: document.nodes[0]! };
  };
  const resolve = (document: string, node: string, as = 'ada') =>
    h.call(as, 'POST', `/v1/documents/${document}/bindings/resolve`, {
      bindings: [{ node, binding: 'b1' }],
    });
  const follow = async (id: string, as = 'ada') => h.call(as, 'GET', `/v1/datasets/pending/${id}`);
  const followed = async (id: string, as = 'ada') => {
    const answer = await follow(id, as);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<Pending>();
  };
  const pendingOf = (answer: { statusCode: number; body: string; json<T>(): T }) => {
    expect(answer.statusCode, answer.body).toBe(202);
    const [result] = answer.json<{ results: Json[] }>().results;
    expect(result).toMatchObject({ pending: expect.any(String) });
    return (result as { pending: string }).pending;
  };
  const count = async (sql: string, values: unknown[] = []) =>
    ((await queryAs(h.db.adminUrl, sql, values)).rows[0] as { n: number }).n;
  const datasetVersions = () =>
    count(
      `select count(*)::int as n from ${h.tenant.schema}.artifact_version where kind = 'dataset'`,
    );
  const resolutionsOf = (document: string) =>
    count(
      `select count(*)::int as n from ${h.tenant.schema}.binding_resolution where document_id = $1`,
      [document],
    );
  /** The uploads admitting an image, by its hash, and the `ingest` jobs queued for them. */
  const uploadsOf = async (image: Buffer) =>
    (
      await queryAs(
        h.db.adminUrl,
        `select u.id, u.origin, u.state, u.alternative, u.uploader,
                (select count(*)::int from platform.job j where j.kind = 'ingest' and j.subject_id = u.id) as jobs
           from ${h.tenant.schema}.asset_upload u where u.object_key like $1 order by u.created_at`,
        [`%/sha256/${hashOf(image)}`],
      )
    ).rows as {
      id: string;
      origin: string;
      state: string;
      alternative: unknown;
      uploader: string;
      jobs: number;
    }[];
  /** What `ingest` does once it has proved an image: the asset recorded, or the upload refused. */
  const admit = (upload: string, image: Buffer) => {
    const read = readImageHeader(image);
    if (!read.ok) throw new Error('not an image');
    return h.tenantDb.withTenant(h.tenant, (trx) => recordAsset(trx, upload, read.header));
  };
  const refuse = (upload: string) =>
    h.tenantDb.withTenant(h.tenant, (trx) =>
      refuseAssetUpload(trx, upload, 'undecodable', 'checking'),
    );
  const stateOf = async (document: string) =>
    (await h.call('ada', 'GET', `/v1/documents/${document}/bindings`)).json<{
      bindings: { held: (Json & { provenance: Json }) | null }[];
    }>().bindings[0]!;

  it('DAT-096 records a result holding images only once every image is admitted', async () => {
    const image = png(3);
    const { document, node } = await placed();
    h.connector.run = ranWithImages([[String(site), 'North', image]]);
    const versions = await datasetVersions();
    const id = pendingOf(await resolve(document.id, node));
    // Nothing recorded: the binding holds nothing, and one upload of the image is being admitted.
    expect(await datasetVersions()).toBe(versions);
    expect(await resolutionsOf(document.id)).toBe(0);
    const [upload, ...others] = await uploadsOf(image);
    expect(others).toEqual([]);
    expect(upload).toMatchObject({
      origin: 'dataset',
      state: 'checking',
      alternative: null,
      uploader: h.ids.ada,
      jobs: 1,
    });
    // The image's bytes are stored by its hash.
    const kept = await h.tenantDb.withTenant(h.tenant, async (trx) =>
      (await h.stores.forTenant(trx, h.tenant)).get(
        `${tenantPrefix(h.tenant)}sha256/${hashOf(image)}`,
      ),
    );
    expect(hashOf(kept)).toBe(hashOf(image));
    expect(await followed(id)).toMatchObject({
      id,
      act: 'resolve',
      state: 'pending',
      result: null,
    });
    expect(await datasetVersions()).toBe(versions);

    const asset = await admit(upload!.id, image);
    const done = await followed(id);
    expect(done).toMatchObject({
      state: 'done',
      result: { node, binding: 'b1', held: { reused: false } },
    });
    expect(await datasetVersions()).toBe(versions + 1);
    expect(await resolutionsOf(document.id)).toBe(1);
    const held = (await stateOf(document.id)).held!;
    expect(held.version).toBe(done.result!.held!.version);
    expect(held.provenance.images).toEqual({ [hashOf(image)]: asset.id });
    // Done and recorded: the pending result is gone.
    expect((await follow(id)).statusCode).toBe(404);
  });

  it('DAT-096 refuses a result whose image is refused, naming its row and column, and records nothing', async () => {
    const admitted = png(5);
    const refused = png(6);
    const { document, node } = await placed();
    h.connector.run = ranWithImages([
      [String(site), 'North', admitted],
      [String(site + 1000), 'South', refused],
    ]);
    const versions = await datasetVersions();
    const id = pendingOf(await resolve(document.id, node));
    await admit((await uploadsOf(admitted))[0]!.id, admitted);
    expect((await followed(id)).state).toBe('pending');
    await refuse((await uploadsOf(refused))[0]!.id);
    const answer = await followed(id);
    expect(answer).toMatchObject({
      state: 'done',
      result: {
        node,
        binding: 'b1',
        failure: {
          code: 'image_refused',
          attribution: 'query',
          row: 2,
          column: 'photo',
          definition: definition.id,
          binding: 'b1',
          node,
          document: document.id,
        },
      },
    });
    expect(answer.result!.failure!.message).toMatch(/column photo, row 2/);
    expect(await datasetVersions()).toBe(versions);
    expect(await resolutionsOf(document.id)).toBe(0);
    // Kept as the record of its refusal, and answered alike when asked again.
    expect(await followed(id)).toEqual(answer);
  });

  it('DAT-096 reuses an image an asset in the space already holds, admitting nothing', async () => {
    const image = png(7);
    const first = await placed();
    h.connector.run = ranWithImages([[String(site), 'North', image]]);
    const id = pendingOf(await resolve(first.document.id, first.node));
    const asset = await admit((await uploadsOf(image))[0]!.id, image);
    expect((await followed(id)).state).toBe('done');

    // Another question whose result holds the same image: held at once, by the same asset.
    const second = await placed();
    h.connector.run = ranWithImages([[String(site), 'Harbour', image]]);
    const answer = await resolve(second.document.id, second.node);
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toMatchObject({
      results: [{ node: second.node, binding: 'b1', held: { reused: false } }],
    });
    expect((await stateOf(second.document.id)).held!.provenance.images).toEqual({
      [hashOf(image)]: asset.id,
    });
    expect(await uploadsOf(image)).toHaveLength(1);
  });

  it('DAT-096 shares one upload between two acts on one image', async () => {
    const image = png(8);
    const one = await placed();
    const two = await placed();
    h.connector.run = ranWithImages([[String(site), 'North', image]]);
    // Both acts reach the image's lock while it is held, so they overlap; let go, they take turns.
    const release = await holdingAdvisoryLock(h.db.adminUrl, `alloy-works:object:${hashOf(image)}`);
    const both = Promise.all([
      resolve(one.document.id, one.node),
      resolve(two.document.id, two.node),
    ]);
    try {
      await untilWaitingOnLocks(h.db.adminUrl, 2);
    } finally {
      await release();
    }
    const [first, second] = await both;
    const ids = [pendingOf(first!), pendingOf(second!)];
    const uploads = await uploadsOf(image);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.jobs).toBe(1);
    const asset = await admit(uploads[0]!.id, image);
    for (const [at, { document }] of [one, two].entries()) {
      expect((await followed(ids[at]!)).state).toBe('done');
      expect((await stateOf(document.id)).held!.provenance.images).toEqual({
        [hashOf(image)]: asset.id,
      });
    }
  });

  it('refuses to finish an older pending result once the binding holds a newer one, recording nothing', async () => {
    const older = png(20);
    const newer = png(21);
    const { document, node } = await placed();
    h.connector.run = ranWithImages([[String(site), 'Old', older]]);
    const first = pendingOf(await resolve(document.id, node));
    h.connector.run = ranWithImages([[String(site), 'New', newer]]);
    const second = pendingOf(await resolve(document.id, node));
    await admit((await uploadsOf(older))[0]!.id, older);
    await admit((await uploadsOf(newer))[0]!.id, newer);
    const held = await followed(second);
    expect(held).toMatchObject({ state: 'done', result: { held: { reused: false } } });
    const versions = await datasetVersions();
    expect(await followed(first)).toMatchObject({
      state: 'done',
      result: { node, binding: 'b1', failure: { code: 'resolution_precondition', node } },
    });
    expect(await datasetVersions()).toBe(versions);
    expect(await resolutionsOf(document.id)).toBe(1);
    expect((await stateOf(document.id)).held!.version).toBe(held.result!.held!.version);
  });

  it('refuses to finish a pending result once a resolve recorded at once has moved what the binding holds', async () => {
    const reused = png(22);
    const waiting = png(23);
    // An asset already holds the first image, so a resolve of it is recorded at once.
    const earlier = await placed();
    h.connector.run = ranWithImages([[String(site), 'Earlier', reused]]);
    const made = pendingOf(await resolve(earlier.document.id, earlier.node));
    await admit((await uploadsOf(reused))[0]!.id, reused);
    expect((await followed(made)).state).toBe('done');

    const { document, node } = await placed();
    h.connector.run = ranWithImages([[String(site), 'Waiting', waiting]]);
    const id = pendingOf(await resolve(document.id, node));
    h.connector.run = ranWithImages([[String(site), 'At once', reused]]);
    const atOnce = await resolve(document.id, node);
    expect(atOnce.statusCode, atOnce.body).toBe(200);
    await admit((await uploadsOf(waiting))[0]!.id, waiting);
    expect(await followed(id)).toMatchObject({
      result: { failure: { code: 'resolution_precondition' } },
    });
    expect(await resolutionsOf(document.id)).toBe(1);
  });

  it("refuses to finish a check's pending result once what the binding holds has moved", async () => {
    const first = png(24);
    const checked = png(25);
    const moved = png(26);
    const { document, node } = await placed();
    h.connector.run = ranWithImages([[String(site), 'North', first]]);
    const resolved = pendingOf(await resolve(document.id, node));
    await admit((await uploadsOf(first))[0]!.id, first);
    expect((await followed(resolved)).state).toBe('done');
    h.connector.run = ranWithImages([[String(site), 'North', checked]]);
    const check = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/check`, {});
    const id = check.json<{ results: { pending: string }[] }>().results[0]!.pending;
    h.connector.run = ranWithImages([[String(site), 'North', moved]]);
    const again = pendingOf(await resolve(document.id, node));
    await admit((await uploadsOf(moved))[0]!.id, moved);
    expect((await followed(again)).state).toBe('done');
    await admit((await uploadsOf(checked))[0]!.id, checked);
    const versions = await datasetVersions();
    expect(await followed(id)).toMatchObject({
      act: 'check',
      result: { outcome: 'failed', failure: { code: 'resolution_precondition' } },
    });
    expect(await datasetVersions()).toBe(versions);
  });

  it('answers a refused image by its row and column only to a caller who may still act', async () => {
    const image = png(27);
    const { document, node } = await placed();
    const grants = [
      await h.allow(h.ids.ivy!, h.roles.Author!, { kind: 'space', id: h.general }),
      await h.allow(h.ids.ivy!, h.roles['Connection user']!, { kind: 'space', id: h.general }),
    ];
    h.connector.run = ranWithImages([[String(site), 'North', image]]);
    const id = pendingOf(await resolve(document.id, node, 'ivy'));
    await refuse((await uploadsOf(image))[0]!.id);
    for (const grant of grants) {
      await h.tenantDb.withTenant(h.tenant, (trx) => removeGrant(trx, grant));
    }
    const answer = await followed(id, 'ivy');
    expect(answer).toMatchObject({ result: { failure: { code: 'access_changed' } } });
    expect(answer.result!.failure).not.toHaveProperty('row');
    expect(answer.result!.failure).not.toHaveProperty('column');
  });

  it('records nothing where the stored result holds an image its pending result names no upload for', async () => {
    const named = png(28);
    const unnamed = png(29);
    const { document, node } = await placed();
    // The result as stored holds two images; the pending result waits on an upload for one.
    const ran = ranWithImages([
      [String(site), 'North', named],
      [String(site + 1000), 'South', unnamed],
    ]);
    if (ran.outcome !== 'ok') throw new Error('expected an answer');
    // The binding's digest as a resolve records it, from a run holding the one image alone.
    h.connector.run = ranWithImages([[String(site), 'North', named]]);
    const real = pendingOf(await resolve(document.id, node));
    const { binding_digest: digest } = (
      await queryAs(
        h.db.adminUrl,
        `select binding_digest from ${h.tenant.schema}.dataset_pending where id = $1`,
        [real],
      )
    ).rows[0] as { binding_digest: string };
    const id = await h.tenantDb.withTenant(h.tenant, async (trx) => {
      const store = await h.stores.forTenant(trx, h.tenant);
      await store.put(Buffer.from(canonicalResultBytes(ran.result), 'utf8'), 'application/json');
      const stored = await store.put(named, 'image/png');
      const { upload } = await uploadForDatasetImage(trx, {
        spaceId: h.general,
        uploader: h.ids.ada!,
        key: stored.key,
        format: 'png',
        bytes: stored.size,
      });
      const defined = (await readQueryDefinition(trx, definition.id))!;
      return (
        await pendingResult(trx, {
          act: 'resolve',
          document: document.id,
          node,
          binding: 'b1',
          digest,
          session: null,
          holding: null,
          provenance: {
            schemaVersion: 1,
            queryDefinition: { artifact: definition.id, version: defined.version.id },
            connection: { artifact: connection.id, version: connection.version },
            parameters: { site: String(site) },
            ran: { sql: ran.ran.sql },
            identity: { kind: 'service' },
            at: '2026-10-05T09:00:00.000Z',
            durationMs: 1,
            rowCount: 2,
            columns: defined.definition.columns,
            canonical: 1,
            checksum: ran.checksum,
            images: {},
          },
          uploads: [upload.id],
          by: h.ids.ada!,
        })
      ).id;
    });
    await admit((await uploadsOf(named))[0]!.id, named);
    const versions = await datasetVersions();
    const answer = await follow(id);
    expect(answer.statusCode, answer.body).toBe(500);
    expect(await datasetVersions()).toBe(versions);
    expect(await resolutionsOf(document.id)).toBe(0);
  });

  it('takes every image lock an act needs in one order, so two acts sharing images across questions never deadlock', async () => {
    const a = png(30);
    const b = png(31);
    const [first, second] = [a, b].sort((x, y) => hashOf(x).localeCompare(hashOf(y)));
    /** A document whose one component holds two bindings, at two sites. */
    const twoSites = async () => {
      const sites = [String((site += 1)), String((site += 1))];
      const component = await h.component(h.general, 'Sites');
      await h.place(
        component,
        binding('b1', definition.id, { parameters: { site: { literal: sites[0]! } } }),
        binding('b2', definition.id, { parameters: { site: { literal: sites[1]! } } }),
      );
      const document = await h.documentReferencing([component.id]);
      return { document, node: document.nodes[0]!, sites };
    };
    const x = await twoSites();
    const y = await twoSites();
    // X's first question holds the later image and its second the earlier; Y's the other way round.
    const holds = new Map([
      [x.sites[0]!, second!],
      [x.sites[1]!, first!],
      [y.sites[0]!, first!],
      [y.sites[1]!, second!],
    ]);
    h.connector.runFor = ({ values }) =>
      ranWithImages([[String(values.site), 'North', holds.get(String(values.site))!]]);
    // Both images held, so each act stops at the first image lock it asks for.
    const releases = [
      await holdingAdvisoryLock(h.db.adminUrl, `alloy-works:object:${hashOf(first!)}`),
      await holdingAdvisoryLock(h.db.adminUrl, `alloy-works:object:${hashOf(second!)}`),
    ];
    const both = [x, y].map(({ document, node }) =>
      h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
        bindings: [
          { node, binding: 'b1' },
          { node, binding: 'b2' },
        ],
      }),
    );
    try {
      await untilWaitingOnLocks(h.db.adminUrl, 2);
    } finally {
      h.connector.runFor = undefined;
      for (const release of releases) await release();
    }
    for (const answer of await Promise.all(both)) {
      expect(answer.statusCode, answer.body).toBe(202);
    }
    expect(await uploadsOf(first!)).toHaveLength(1);
    expect(await uploadsOf(second!)).toHaveLength(1);
  });

  describe('a dataset image is read only through a document holding it (D8-I)', () => {
    /**
     * How many search entries an asset has: what the library finds it by, words or none. An image a
     * result holds carries no description, so no words would find it; it has no entry at all.
     */
    const entries = (asset: string) =>
      count(
        `select count(*)::int as n from ${h.tenant.schema}.search_entry where artifact_id = $1`,
        [asset],
      );

    it('refuses a dataset image to a reader of its space who reads no document holding it, and keeps it out of search', async () => {
      const image = png(40);
      // The definition and so the asset in General; the document holding it in Quality, which Alice
      // does not read.
      const component = await h.component(h.general, 'Sites');
      site += 1;
      await h.place(
        component,
        binding('b1', definition.id, { parameters: { site: { literal: String(site) } } }),
      );
      const document = await h.documentReferencing([component.id], h.quality);
      const node = document.nodes[0]!;
      h.connector.run = ranWithImages([[String(site), 'North', image]]);
      const id = pendingOf(await resolve(document.id, node));
      const asset = await admit((await uploadsOf(image))[0]!.id, image);
      expect((await followed(id)).state).toBe('done');

      for (const path of [
        `/v1/asset-versions/${asset.id}`,
        `/v1/asset-versions/${asset.id}/content`,
      ]) {
        const refused = await h.call('alice', 'GET', path);
        expect(refused.statusCode, path).toBe(404);
        expect(refused.json(), path).toMatchObject({ code: 'not_found' });
        // Ada reads the document holding it.
        expect((await h.call('ada', 'GET', path)).statusCode, path).toBe(200);
      }
      expect(await entries(asset.artifactId)).toBe(0);
    });

    it('reads a dataset image for a reader of a document holding it, and an uploaded asset as before', async () => {
      const image = png(41);
      const { document, node } = await placed();
      h.connector.run = ranWithImages([[String(site), 'North', image]]);
      const id = pendingOf(await resolve(document.id, node));
      const asset = await admit((await uploadsOf(image))[0]!.id, image);
      expect((await followed(id)).state).toBe('done');
      // Alice reads General, where the document is.
      expect((await h.call('alice', 'GET', `/v1/asset-versions/${asset.id}`)).statusCode).toBe(200);

      // An image a person uploaded: read by its space's readers, and found.
      const uploaded = png(42);
      const made = await h.call('ada', 'POST', `/v1/spaces/${h.general}/asset-uploads`, {
        alternative: null,
      });
      expect(made.statusCode, made.body).toBe(200);
      const upload = made.json<{ id: string }>().id;
      const filled = await h.app.inject({
        method: 'PUT',
        url: `/v1/asset-uploads/${upload}/bytes`,
        headers: {
          host: 'acme.alloy.test',
          cookie: h.cookies.ada!,
          'content-type': 'application/octet-stream',
        },
        payload: uploaded,
      });
      expect(filled.statusCode, filled.body).toBe(200);
      const own = await admit(upload, uploaded);
      expect((await h.call('alice', 'GET', `/v1/asset-versions/${own.id}`)).statusCode).toBe(200);
      expect(
        (await h.call('alice', 'GET', `/v1/asset-versions/${own.id}/content`)).statusCode,
      ).toBe(200);
      expect(await entries(own.artifactId)).toBe(1);
    });
  });

  it('answers a pending result only to the person whose act ran it', async () => {
    const image = png(9);
    const { document, node } = await placed();
    h.connector.run = ranWithImages([[String(site), 'North', image]]);
    const id = pendingOf(await resolve(document.id, node));
    for (const other of ['grace', 'alice', 'ivy']) {
      const answer = await follow(id, other);
      expect(answer.statusCode, other).toBe(404);
      expect(answer.json()).toMatchObject({ code: 'not_found' });
    }
    expect((await follow('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await followed(id)).state).toBe('pending');
  });

  it("answers somebody else's request for a pending result without waiting on its row", async () => {
    const image = png(32);
    const { document, node } = await placed();
    h.connector.run = ranWithImages([[String(site), 'North', image]]);
    const id = pendingOf(await resolve(document.id, node));
    // The row held, as a finish holds it: another person is answered at once all the same.
    const status = await h.tenantDb.withTenant(h.tenant, async (trx) => {
      await readPendingResult(trx, id, true);
      return Promise.race([
        follow(id, 'grace').then((answer) => answer.statusCode),
        new Promise<string>((settle) => setTimeout(() => settle('waited'), 2_000)),
      ]);
    });
    expect(status).toBe(404);
  });

  it('finishes a pending result once, however many ask at once', async () => {
    const image = png(10);
    const { document, node } = await placed();
    h.connector.run = ranWithImages([[String(site), 'North', image]]);
    const id = pendingOf(await resolve(document.id, node));
    await admit((await uploadsOf(image))[0]!.id, image);
    const versions = await datasetVersions();
    const answers = await Promise.all([follow(id), follow(id), follow(id)]);
    expect(answers.map((each) => each.statusCode).sort()).toEqual([200, 404, 404]);
    expect(await datasetVersions()).toBe(versions + 1);
    expect(await resolutionsOf(document.id)).toBe(1);
  });

  it('refuses a pending result whose binding changed while its images were admitted, recording nothing', async () => {
    const image = png(11);
    const { component, document, node } = await placed();
    h.connector.run = ranWithImages([[String(site), 'North', image]]);
    const id = pendingOf(await resolve(document.id, node));
    await h.place(
      component,
      binding('b1', definition.id, {
        parameters: { site: { literal: String(site) } },
        mode: 'pinned',
      }),
    );
    await admit((await uploadsOf(image))[0]!.id, image);
    const versions = await datasetVersions();
    expect(await followed(id)).toMatchObject({
      state: 'done',
      result: { failure: { code: 'binding_changed', binding: 'b1', node } },
    });
    expect(await datasetVersions()).toBe(versions);
    expect(await resolutionsOf(document.id)).toBe(0);
  });

  it('finishes a check whose different result holds a new image as the check would have: a revision waiting', async () => {
    const before = png(12);
    const after = png(13);
    const { document, node } = await placed();
    h.connector.run = ranWithImages([[String(site), 'North', before]]);
    const resolved = pendingOf(await resolve(document.id, node));
    await admit((await uploadsOf(before))[0]!.id, before);
    expect((await followed(resolved)).state).toBe('done');

    h.connector.run = ranWithImages([[String(site), 'North', after]]);
    const checked = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/check`, {});
    expect(checked.statusCode, checked.body).toBe(202);
    const [result] = checked.json<{ results: Json[] }>().results;
    expect(result).toMatchObject({ node, binding: 'b1', outcome: 'pending' });
    const id = (result as { pending: string }).pending;
    expect(await followed(id)).toMatchObject({ act: 'check', state: 'pending' });
    const asset = await admit((await uploadsOf(after))[0]!.id, after);
    const done = await followed(id);
    expect(done).toMatchObject({
      state: 'done',
      result: { node, binding: 'b1', outcome: 'revision', version: expect.any(String) },
    });
    // Waiting, not held: the binding still holds the first result.
    const bindings = (await h.call('ada', 'GET', `/v1/documents/${document.id}/bindings`)).json<{
      bindings: { waiting: { version: string; provenance: Json } | null }[];
    }>().bindings;
    expect(bindings[0]!.waiting).toMatchObject({
      version: (done.result as { version: string }).version,
      provenance: { images: { [hashOf(after)]: asset.id } },
    });
    expect(await resolutionsOf(document.id)).toBe(1);
  });

  it('refuses a run whose image is not the bytes its hash names as the connector failing, recording nothing', async () => {
    const { document, node } = await placed();
    const lying = ranWithImages([[String(site), 'North', png(14)]]);
    if (lying.outcome !== 'ok') throw new Error('expected an answer');
    const [hash] = Object.keys(lying.images!);
    h.connector.run = { ...lying, images: { [hash!]: png(15).toString('base64') } };
    const answer = await resolve(document.id, node);
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toMatchObject({
      results: [{ node, binding: 'b1', failure: { code: 'connector_error' } }],
    });
    expect(await resolutionsOf(document.id)).toBe(0);
  });

  describe('a bound image in the bindings view (the B6 plan, task 3)', () => {
    const DESCRIBED = { base: 'image', encoding: 'binary', description: { column: 'name' } };
    let described: { id: string; version: string };

    beforeAll(async () => {
      described = await h.definition(connection.id, {
        columns: PHOTO_COLUMNS.map((column) =>
          column.name === 'photo' ? { ...column, type: DESCRIBED } : column,
        ),
      });
    });

    const photo = (id: string) =>
      binding(id, described.id, {
        parameters: { site: { literal: String(site) } },
        take: { column: 'photo' },
      });
    const words = (value: string) => ({ type: 'text', value, marks: [] });
    /**
     * A component placing the photograph in a line, as a figure, in its caption, as a figure taking a text column,
     * and in a footnote's text: five bindings asking one question, at a new site.
     */
    const placedFour = async () => {
      site += 1;
      const component = await h.component(h.general, 'Sites');
      await h.placeBlocks(
        component,
        { type: 'paragraph', id: 'p1', style: 'body', content: [words('Gate '), photo('b1')] },
        {
          type: 'figure',
          id: 'f1',
          binding: photo('b2'),
          imageStyle: 'figure',
          caption: [words('The gate '), photo('b5')],
          alternative: { kind: 'inherited' },
        },
        {
          type: 'figure',
          id: 'f2',
          binding: { ...photo('b3'), take: { column: 'name' } },
          imageStyle: 'figure',
          caption: [words('Its name')],
          alternative: { kind: 'inherited' },
        },
        {
          type: 'paragraph',
          id: 'p2',
          style: 'body',
          content: [
            words('Noted.'),
            {
              type: 'footnote',
              id: 'n1',
              anchor: { kind: 'span' },
              content: [{ type: 'paragraph', id: 'np1', style: 'body', content: [photo('b4')] }],
            },
          ],
        },
      );
      const document = await h.documentReferencing([component.id]);
      return { document, node: document.nodes[0]! };
    };
    const resolveAll = (document: string, node: string) =>
      h.call('ada', 'POST', `/v1/documents/${document}/bindings/resolve`, {
        bindings: ['b1', 'b2', 'b3', 'b4', 'b5'].map((each) => ({ node, binding: each })),
      });
    const takenIn = async (document: string) =>
      Object.fromEntries(
        (await h.call('ada', 'GET', `/v1/documents/${document}/bindings`))
          .json<{ bindings: { binding: { id: string }; held: { taken: unknown } | null }[] }>()
          .bindings.map((each) => [each.binding.id, each.held?.taken ?? null]),
      );

    it("DAT-097 answers a bound image's asset version and its description, read from its definition's column, and why one cannot stand where it is placed", async () => {
      const image = png(61);
      // Admitted once, by a first question, so the four below are held at once (DAT-096).
      const first = await placed();
      h.connector.run = ranWithImages([[String(site), 'North gate', image]]);
      const id = pendingOf(await resolve(first.document.id, first.node));
      const asset = await admit((await uploadsOf(image))[0]!.id, image);
      expect((await followed(id)).state).toBe('done');

      const { document, node } = await placedFour();
      h.connector.run = ranWithImages([[String(site), 'North gate', image]]);
      const answer = await resolveAll(document.id, node);
      expect(answer.statusCode, answer.body).toBe(200);
      const shown = {
        image: hashOf(image),
        assetVersion: asset.id,
        description: 'North gate',
        column: { name: 'photo', type: DESCRIBED },
      };
      expect(await takenIn(document.id)).toEqual({
        b1: shown,
        b2: shown,
        b3: { failure: 'value_not_image' },
        b4: { failure: 'image_not_placeable' },
        // An image in a caption, which the publish refuses too.
        b5: { failure: 'image_not_placeable' },
      });
      // The bytes, to a reader of the document holding it (D8-I).
      expect(
        (await h.call('ada', 'GET', `/v1/asset-versions/${asset.id}/content`)).statusCode,
      ).toBe(200);
    });

    it('DAT-097 answers a bound image whose description is null image_description_missing in place, naming the column', async () => {
      const image = png(62);
      const first = await placed();
      h.connector.run = ranWithImages([[String(site), 'Harbour', image]]);
      const id = pendingOf(await resolve(first.document.id, first.node));
      await admit((await uploadsOf(image))[0]!.id, image);
      expect((await followed(id)).state).toBe('done');

      const { document, node } = await placedFour();
      h.connector.run = ranWithImages([[String(site), null, image]]);
      expect((await resolveAll(document.id, node)).statusCode).toBe(200);
      const missing = { failure: 'image_description_missing', column: 'name' };
      expect(await takenIn(document.id)).toMatchObject({ b1: missing, b2: missing, b4: missing });
    });

    it('DAT-097 answers the image of a figure its author marked decorative though its row has no description, as the publish prints it', async () => {
      const image = png(63);
      const first = await placed();
      h.connector.run = ranWithImages([[String(site), 'Quay', image]]);
      const id = pendingOf(await resolve(first.document.id, first.node));
      const asset = await admit((await uploadsOf(image))[0]!.id, image);
      expect((await followed(id)).state).toBe('done');

      site += 1;
      const component = await h.component(h.general, 'Sites');
      await h.placeBlocks(
        component,
        { type: 'paragraph', id: 'p1', style: 'body', content: [words('Quay '), photo('b1')] },
        {
          type: 'figure',
          id: 'f1',
          binding: photo('b2'),
          imageStyle: 'figure',
          caption: [words('The quay')],
          alternative: { kind: 'decorative' },
        },
      );
      const document = await h.documentReferencing([component.id]);
      h.connector.run = ranWithImages([[String(site), null, image]]);
      const answer = await h.call('ada', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
        bindings: ['b1', 'b2'].map((each) => ({ node: document.nodes[0]!, binding: each })),
      });
      expect(answer.statusCode, answer.body).toBe(200);
      expect(await takenIn(document.id)).toEqual({
        // In a line the description is still required.
        b1: { failure: 'image_description_missing', column: 'name' },
        // The decorative figure shows its image, taken as though its column were declared decorative.
        b2: {
          image: hashOf(image),
          assetVersion: asset.id,
          description: 'decorative',
          column: { name: 'photo', type: { ...DESCRIBED, description: 'decorative' } },
        },
      });
    });
  });
});
