import { crc32, deflateSync } from 'node:zlib';
import { recordAsset, refuseAssetUpload } from '@alloy-works/db';
import { queryAs } from '@alloy-works/db/testing';
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
const ranWithImages = (rows: [string, string, Buffer | null][]): RunAnswer => {
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
    const [first, second] = await Promise.all([
      resolve(one.document.id, one.node),
      resolve(two.document.id, two.node),
    ]);
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
});
