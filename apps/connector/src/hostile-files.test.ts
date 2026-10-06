import { fileURLToPath } from 'node:url';

import type { Column, DataFormat, RunAnswer } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { XLSX_MAX_BYTES } from './formats/rows.js';
import { childSpawn, createSupervisor, runChild, type SpawnChild } from './supervisor.js';
import {
  field,
  fileDraft,
  keyOf,
  s3RunRequest,
  s3Settings,
  SOURCES_CA,
  startFakeStore,
  type FakeStore,
} from './testing/s3.js';
import {
  LOADED_TIMEOUT_MS,
  SEALING_KEY,
  suiteChild,
  suiteDeny,
  suiteIsolation,
} from './testing/source.js';
import {
  cell,
  deflateFrom,
  escapeXml,
  hugeSharedString,
  makeZip,
  row,
  rowsXml,
  sheetXml,
  workbookEntries,
} from './testing/xlsx.js';

/**
 * Every reader over a hostile file, as a run reads one (the D6 plan's risks): each file an object the
 * suite's own store answers, read in a child that reports the most memory it held, which D2's run at
 * the ceilings - 371 MiB - bounds. And XLSX at its ceiling, measured as D6.1 and D6.2 measured theirs.
 */

const RUN_AT_THE_CEILINGS = 371 * 1024 * 1024;
const LARGEST = { rows: 100_000, bytes: 25 * 1024 * 1024, seconds: 120 };

const XLSX: DataFormat = { kind: 'xlsx', sheet: 'Readings', headerRow: false };

describe('a hostile file', { timeout: LOADED_TIMEOUT_MS }, () => {
  let store: FakeStore;
  let body = Buffer.alloc(0);
  beforeAll(async () => {
    store = await startFakeStore(() => ({ body }));
  });
  afterAll(async () => {
    await store.close();
  });

  /** A run of `served` as an object, in a measured child: its answer and its peak resident set. */
  async function measured(
    served: Buffer,
    format: DataFormat,
    columns: Column[],
    over: { key?: string[]; order?: 'multiset' } = {},
  ) {
    body = served;
    const peaks: number[] = [];
    const measuring: SpawnChild = (spec, input, deadlineMs) =>
      runChild(spec, input, deadlineMs, (chunk) => {
        const line = /\{"peakBytes":(\d+)\}/.exec(chunk.toString('utf8'));
        if (line) peaks.push(Number(line[1]));
      });
    const supervisor = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 1,
      spec: childSpawn(
        {
          path: fileURLToPath(new URL('./testing/measured-child.ts', import.meta.url)),
          execArgv: suiteChild.execArgv,
        },
        suiteIsolation,
      ),
      spawn: measuring,
      ca: SOURCES_CA,
    });
    const answer = await supervisor.run(
      'run',
      s3RunRequest(
        s3Settings(store.port),
        fileDraft(keyOf('hostile/file'), columns, { format, limits: LARGEST, ...over }),
        {},
        { deadlineMs: 120_000 },
      ),
    );
    const peak = peaks[0] ?? Number.POSITIVE_INFINITY;
    process.stdout.write(
      `${JSON.stringify({ format: format.kind, bytes: served.length, peakMiB: Math.round(peak / 1048576) })}\n`,
    );
    return { answer, peak };
  }

  const failure = (answer: RunAnswer | 'busy') =>
    answer !== 'busy' && answer.outcome === 'failed' ? answer.failure.code : answer;

  const site = [{ name: 'site', from: { letter: 'A' }, type: { base: 'text' } } as Column];
  const sheetEntries = () =>
    workbookEntries({
      sheets: [{ name: 'Readings', xml: sheetXml(row(1, [cell.text('A1', 'x')])) }],
    });
  const replacing = (name: string, deflated: { bytes: Buffer; size: number; crc: number }) =>
    makeZip(sheetEntries().map((entry) => (entry.name === name ? { name, deflated } : entry)));

  it('DAT-110 holds each reader to a named failure over a hostile file, in a child within the memory a run at the ceilings takes: a sheet bomb, a shared string past the limit, an entry flood, mismatched zip headers, an entity, deep JSON and an unterminated CSV record', async () => {
    const cases: [string, Buffer, DataFormat, Column[], string][] = [
      [
        'a sheet inflating to 64 MiB',
        replacing('xl/worksheets/sheet1.xml', await deflateFrom(rowsXml(62_000, 'x'.repeat(1000)))),
        XLSX,
        site,
        'byte_limit',
      ],
      [
        'one shared string of 64 MiB',
        replacing('xl/sharedStrings.xml', await deflateFrom(hugeSharedString(64 * 1024 * 1024))),
        XLSX,
        site,
        'byte_limit',
      ],
      [
        '65,000 empty entries',
        makeZip([
          ...sheetEntries(),
          ...Array.from({ length: 65_000 }, (_, at) => ({ name: `e/${at}`, stored: true })),
        ]),
        XLSX,
        site,
        'byte_limit',
      ],
      [
        'a local header naming another part than the directory',
        makeZip(
          sheetEntries().map((entry) =>
            entry.name === 'xl/workbook.xml' ? { ...entry, localName: 'xl/workbook.xmm' } : entry,
          ),
        ),
        XLSX,
        site,
        'result_mismatch',
      ],
      [
        'an entity declared in a DOCTYPE',
        makeZip(
          sheetEntries().map((entry) =>
            entry.name === 'xl/worksheets/sheet1.xml'
              ? {
                  ...entry,
                  data: Buffer.from(
                    sheetXml(row(1, [cell.text('A1', 'x')])).replace(
                      '?>',
                      `?><!DOCTYPE worksheet [<!ENTITY a "${escapeXml('b'.repeat(64))}">]>`,
                    ),
                  ),
                }
              : entry,
          ),
        ),
        XLSX,
        site,
        'result_mismatch',
      ],
      [
        'JSON nested 1,000,000 deep',
        Buffer.from(`{"items":${'['.repeat(1_000_000)}${']'.repeat(1_000_000)}}`),
        { kind: 'json', rows: '/items' },
        [{ name: 'site', from: { pointer: '/site' }, type: { base: 'text' } }],
        'result_mismatch',
      ],
      [
        'a JSON line nested 1,000,000 deep',
        Buffer.from(`${'['.repeat(1_000_000)}${']'.repeat(1_000_000)}\n`),
        { kind: 'jsonLines' },
        [{ name: 'site', from: { pointer: '/site' }, type: { base: 'text' } }],
        'result_mismatch',
      ],
      [
        'a CSV record whose quote is never closed, 5 MiB of it',
        Buffer.concat([Buffer.from('site\n"'), Buffer.alloc(5 * 1024 * 1024, 0x78)]),
        { kind: 'csv', delimiter: 'comma', headerRow: true, null: 'empty' },
        [field('site', { base: 'text' })],
        'result_mismatch',
      ],
    ];
    for (const [name, served, format, columns, code] of cases) {
      const { answer, peak } = await measured(served, format, columns);
      expect(failure(answer), name).toBe(code);
      expect(peak, name).toBeLessThan(RUN_AT_THE_CEILINGS);
    }
  });

  /**
   * A workbook as a writer makes one, of the widest rows measured: an id, then numbers and shared
   * strings in turn, every string its own; and its size inflated, every part counted.
   */
  async function wideWorkbook(rows: number, columns: number) {
    const strings: string[] = [];
    function* sheet(): Generator<Buffer> {
      yield Buffer.from(sheetXml('').replace('</sheetData></worksheet>', ''));
      const parts: string[] = [];
      for (let r = 1; r <= rows; r += 1) {
        const cells = [cell.number(`A${r}`, String(r))];
        for (let at = 0; at < columns; at += 1) {
          const ref = `${String.fromCharCode(66 + at)}${r}`;
          if (at % 2 === 0) {
            cells.push(cell.number(ref, `${r}${at}.${String(r % 100).padStart(2, '0')}`));
          } else {
            cells.push(cell.shared(ref, strings.length));
            strings.push(`r${r}c${at}`);
          }
        }
        parts.push(row(r, cells));
        if (parts.length === 1000) {
          yield Buffer.from(parts.join(''));
          parts.length = 0;
        }
      }
      if (parts.length) yield Buffer.from(parts.join(''));
      yield Buffer.from('</sheetData></worksheet>');
    }
    const deflatedSheet = await deflateFrom(sheet());
    const entries = workbookEntries({
      sheets: [{ name: 'Readings', xml: '' }],
      shared: strings,
    });
    const inflated =
      deflatedSheet.size +
      entries
        .filter((entry) => entry.name !== 'xl/worksheets/sheet1.xml')
        .reduce((sum, entry) => sum + (entry.data?.length ?? 0), 0);
    const zipped = makeZip(
      entries.map((entry) =>
        entry.name === 'xl/worksheets/sheet1.xml'
          ? { name: entry.name, deflated: deflatedSheet }
          : entry,
      ),
    );
    return { zipped, inflated };
  }

  /** The widest rows measured, as JSON's, JSON Lines' and CSV's were: 15 columns after the id. */
  const WIDE_COLUMNS = 15;
  const XLSX_ROWS = 18_000;

  const wideColumns = (): Column[] => [
    { name: 'id', from: { letter: 'A' }, type: { base: 'integer' } },
    ...Array.from({ length: WIDE_COLUMNS }, (_, at): Column => ({
      name: `c${at}`,
      from: { letter: String.fromCharCode(66 + at) },
      type: at % 2 === 0 ? { base: 'decimal', precision: 20, scale: 2 } : { base: 'text' },
    })),
  ];

  it('reads an XLSX at its ceiling, every part inflated, within the memory a run at the ceilings takes, and refuses one past it', async () => {
    const atCeiling = await wideWorkbook(XLSX_ROWS, WIDE_COLUMNS);
    process.stdout.write(`${JSON.stringify({ rows: XLSX_ROWS, inflated: atCeiling.inflated })}\n`);
    // Not vacuous: within a megabyte of the ceiling, every row read.
    expect(atCeiling.inflated).toBeGreaterThan(XLSX_MAX_BYTES - 1024 * 1024);
    expect(atCeiling.inflated).toBeLessThanOrEqual(XLSX_MAX_BYTES);
    const read = await measured(atCeiling.zipped, XLSX, wideColumns(), {
      key: ['id'],
      order: [{ column: 'id', direction: 'ascending' }],
    } as never);
    expect(read.answer !== 'busy' && read.answer.outcome === 'ok' && read.answer.rowCount).toBe(
      XLSX_ROWS,
    );
    expect(read.peak).toBeLessThan(RUN_AT_THE_CEILINGS);
    const past = await wideWorkbook(Math.ceil(XLSX_ROWS * 1.1), WIDE_COLUMNS);
    expect(past.inflated).toBeGreaterThan(XLSX_MAX_BYTES);
    expect(failure((await measured(past.zipped, XLSX, wideColumns())).answer)).toBe('byte_limit');
  });
});
