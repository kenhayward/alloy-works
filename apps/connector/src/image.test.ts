import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';

import {
  ASSET_MAX_BYTES,
  canonicalResultBytes,
  type ColumnType,
  type RunAnswer,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { readImage } from './image.js';
import { finishResult } from './result.js';
import { childSpawn, createSupervisor } from './supervisor.js';
import { gif, jpeg, png } from './testing/images.js';
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

/** Image columns (the D8 plan, task 1): read, admitted by the door's header reading, and hashed. */

const supervisor = createSupervisor({
  sealingKey: SEALING_KEY,
  deny: suiteDeny,
  maxChildren: 8,
  spec: childSpawn(suiteChild, suiteIsolation),
});

const run = async (
  definition: ReturnType<typeof draft>,
  limits: Parameters<typeof runRequest>[4] = {},
): Promise<RunAnswer> => {
  const answer = await supervisor.run(
    'run',
    runRequest(settings(), PASSWORDS.reader, definition, {}, limits),
  );
  if (answer === 'busy') throw new Error('busy');
  return answer;
};

const failure = (answer: RunAnswer) =>
  answer.outcome === 'failed' ? answer.failure : { unexpected: answer.outcome };

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const hex = (bytes: Buffer) => `decode('${bytes.toString('hex')}', 'hex')`;
const base64 = (bytes: Buffer) => `'${bytes.toString('base64')}'::text`;

const binary: ColumnType = { base: 'image', encoding: 'binary', description: 'decorative' };
const text64: ColumnType = { base: 'image', encoding: 'base64', description: 'decorative' };
const id = column('id', { base: 'integer' });

/** One image column over two rows: the first a good PNG, the second the value given. */
const second = (value: string, type: ColumnType = binary) =>
  run(
    draft(
      `select * from (values (1::int8, ${type === binary ? hex(png()) : base64(png())}), (2::int8, ${value})) as t (id, photo) order by id`,
      [id, column('photo', type)],
    ),
  );

describe('an image column', { timeout: LOADED_TIMEOUT_MS }, () => {
  it('DAT-096 reads a bytea PNG and a base64 JPEG each to one hash of the image alone, trailing bytes dropped, and one image under either encoding to one hash', async () => {
    const picture = png();
    const photo = jpeg();
    const answer = await run(
      draft(
        `select * from (values
           (1::int8, ${hex(png({ after: [1, 2, 3] }))}, ${base64(jpeg({ after: [0x50, 0x4b, 3, 4] }))}, ${base64(picture)}),
           (2::int8, ${hex(picture)}, ${base64(photo)}, ${base64(png({ after: [9] }))})
         ) as t (id, png, jpeg, again) order by id`,
        [id, column('png', binary), column('jpeg', text64), column('again', text64)],
      ),
    );
    if (answer.outcome !== 'ok') throw new Error(JSON.stringify(answer));
    const [pictureHash, photoHash] = [sha256(picture), sha256(photo)];
    expect(answer.result).toEqual({
      columns: [
        ['id', 'integer'],
        ['png', 'image'],
        ['jpeg', 'image'],
        ['again', 'image'],
      ],
      rows: [
        ['1', pictureHash, photoHash, pictureHash],
        ['2', pictureHash, photoHash, pictureHash],
      ],
    });
    // Each image once, the image alone, whatever followed it in the source.
    expect(answer.images).toEqual({
      [pictureHash]: picture.toString('base64'),
      [photoHash]: photo.toString('base64'),
    });
    expect(answer.checksum).toBe(sha256(Buffer.from(canonicalResultBytes(answer.result))));
  });

  it("DAT-080 holds an image column's hash in its cell, never the image's bytes", async () => {
    const picture = png();
    const answer = await second(hex(picture));
    if (answer.outcome !== 'ok') throw new Error(JSON.stringify(answer));
    const bytes = canonicalResultBytes(answer.result);
    expect(answer.result.rows).toEqual([
      ['1', sha256(picture)],
      ['2', sha256(picture)],
    ]);
    expect(bytes).not.toContain(picture.toString('hex'));
    expect(bytes).not.toContain(picture.toString('base64'));
  });

  it('DAT-096 refuses a GIF, a truncated PNG and an image past the pixel limit as image_refused, naming the row and the column', async () => {
    for (const [label, bytes] of [
      ['a GIF', gif()],
      ['a truncated PNG', png().subarray(0, 30)],
      ['past the pixel limit', png({ width: 10_000, height: 10_000 })],
    ] as const) {
      expect(failure(await second(hex(bytes))), label).toEqual({
        code: 'image_refused',
        attribution: 'query',
        column: 'photo',
        row: 2,
      });
    }
    // And under base64 the same.
    expect(failure(await second(base64(gif()), text64))).toEqual({
      code: 'image_refused',
      attribution: 'query',
      column: 'photo',
      row: 2,
    });
  });

  it('refuses a bytea declared base64, and text declared binary, as result_mismatch naming the column', async () => {
    expect(
      failure(
        await run(
          draft(`select 1::int8 as id, ${hex(png())} as photo`, [id, column('photo', text64)]),
        ),
      ),
    ).toEqual({ code: 'result_mismatch', attribution: 'query', column: 'photo' });
    expect(
      failure(
        await run(
          draft(`select 1::int8 as id, ${base64(png())} as photo`, [id, column('photo', binary)]),
        ),
      ),
    ).toEqual({ code: 'result_mismatch', attribution: 'query', column: 'photo' });
  });

  it('refuses base64 with whitespace, with its padding missing, or outside its alphabet, and a bytea a statement printed as escapes', async () => {
    const written = png().toString('base64');
    expect(written.endsWith('=')).toBe(true);
    for (const value of [
      `${written.slice(0, 8)} ${written.slice(8)}`,
      `${written.slice(0, 8)}\n${written.slice(8)}`,
      written.replace(/=+$/, ''),
      written.replace(/\+/g, '-').replace(/\//g, '_').replace(/^./, '-'),
    ]) {
      expect(failure(await second(`'${value}'::text`, text64)), JSON.stringify(value)).toEqual({
        code: 'image_refused',
        attribution: 'query',
        column: 'photo',
        row: 2,
      });
    }
    // A statement that sets bytea's output to escapes is read as no image, never misread as one.
    expect(
      failure(
        await run(
          draft(
            `with escaped as (select set_config('bytea_output', 'escape', true))
             select 1::int8 as id, ${hex(png())} as photo from escaped`,
            [id, column('photo', binary)],
          ),
        ),
      ),
    ).toEqual({ code: 'image_refused', attribution: 'query', column: 'photo', row: 1 });
  });
});

describe('reading an image cell', () => {
  it('reads PostgreSQL hex and padded base64 to the image alone and its hash', () => {
    const picture = png();
    const withTail = png({ after: [1, 2] });
    for (const read of [
      readImage(`\\x${withTail.toString('hex')}`, 'binary'),
      readImage(withTail.toString('base64'), 'base64'),
    ]) {
      expect(read).toEqual({ hash: sha256(picture), bytes: picture });
    }
  });

  it('refuses what is not one image: empty, odd or upper-case hex, base64 of the wrong length, and an image past the door', () => {
    const picture = png().toString('hex');
    for (const [text, encoding] of [
      ['', 'binary'],
      ['\\x', 'binary'],
      ['', 'base64'],
      [picture, 'binary'],
      [`\\x${picture}0`, 'binary'],
      [`\\x${picture.toUpperCase()}`, 'binary'],
      ['AAA=A', 'base64'],
      ['A===', 'base64'],
    ] as const) {
      expect(readImage(text, encoding), JSON.stringify(text)).toEqual({ refused: true });
    }
    // A PNG whose own structure runs past the door's byte limit.
    const large = png({ width: 4, height: 3 });
    const idat = Buffer.alloc(ASSET_MAX_BYTES + 1);
    const padded = Buffer.concat([
      large.subarray(0, 33),
      chunkOf('IDAT', idat),
      large.subarray(-12),
    ]);
    expect(readImage(`\\x${padded.toString('hex')}`, 'binary')).toEqual({ refused: true });
  });

  it("counts a result's image bytes against its byte limit, beside its canonical bytes (D8-C)", () => {
    const definition = {
      columns: [column('id', { base: 'integer' })],
      key: ['id'],
      order: [{ column: 'id', direction: 'ascending' as const }],
      empty: 'valid' as const,
    };
    const canonical = Buffer.byteLength(
      canonicalResultBytes({ columns: [['id', 'integer']], rows: [['1']] }),
    );
    const limits = { rows: 10, bytes: canonical + 100, seconds: 10 };
    expect(finishResult([['1']], definition, limits, 100)).toMatchObject({ rowCount: 1 });
    expect(finishResult([['1']], definition, limits, 101)).toEqual({
      failure: { code: 'byte_limit', attribution: 'query' },
    });
  });
});

/** A PNG chunk of this type and data, its CRC right. */
function chunkOf(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
