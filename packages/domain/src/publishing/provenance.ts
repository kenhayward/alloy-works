import type { Binding } from '../data/binding.js';
import type { ColumnType, ImageColumnType, ValueType } from '../data/columns.js';
import type { ParameterValues } from '../data/parameters.js';
import type { Provenance } from '../data/provenance.js';
import { canonicalJson } from '../stored/canonical.js';
import { sectionNumbers, type NumberingTable } from '../structure/numbering.js';

import type { PrintedTable, PrintedValue } from './bind.js';

/** A dataset version a value was taken from: its dataset, its name, its number and its provenance. */
export interface HeldDataset {
  readonly id: string;
  readonly name: string | null;
  readonly number: string;
  readonly provenance: Provenance;
}

/** Where a value stands and the result it was taken from: what both arms of a value record. */
interface FromResult {
  readonly node: string;
  readonly number: string | null;
  readonly block: string;
  readonly binding: string;
  readonly dataset: {
    readonly id: string;
    readonly name: string | null;
    readonly version: string;
    readonly number: string;
  };
  readonly result: {
    readonly queryDefinition: { readonly artifact: string; readonly version: string };
    readonly parameters: ParameterValues;
    readonly identity: { readonly kind: string };
    readonly at: string;
    readonly durationMs: number;
    readonly rowCount: number;
    readonly columns: readonly { readonly name: string; readonly type: ColumnType }[];
    readonly canonical: number;
    readonly checksum: string;
  };
}

/**
 * The version every new `provenance.json` is written at: 2 since a value gained an image arm (B6-I),
 * 3 since a bound table's (TB1-J).
 */
export const PUBLISHED_PROVENANCE_VERSION = 3;

/**
 * **`provenance.json`** (the B3 plan, B3-G; DAT-042, PUB-049): every value a publication printed,
 * where it stands - its node and that node's number, its block and its binding - what was printed and
 * the canonical value and column it was printed from, the take, the dataset by name and version, and
 * the result's provenance **built from an allow-list**: never the SQL that ran, the connection, or a
 * column's source, which only a reader of the definition may see, and nothing D3 adds later.
 *
 * **At `schemaVersion` 2** (the B6 plan, B6-I): a value may instead be an image, recorded by its hash
 * and the asset version it was placed as, with the description it was given - its text, or
 * `decorative`. **At 3** (the TB1 plan, TB1-J; TAB-019, TAB-015): a value may instead be a bound
 * table, recorded with no take - it binds the whole result - by each column shown, its header and the
 * format it was printed by, its rounding rule among it, and each printed cell, row by row, with the
 * canonical value it was printed from. Every new publication is written at 3; a file written earlier
 * stays as written. **A table's `notes`** (the TB3 plan) are each note printed beneath it, by its letter,
 * the printed row it marks (null for a column's) and its column - never a keyed note's key, which the
 * table need not print: added to the arm at 3, absent from a file of pipeline 18 or earlier.
 */
export interface PublishedProvenance {
  readonly schemaVersion: typeof PUBLISHED_PROVENANCE_VERSION;
  readonly values: readonly (
    | (FromResult & {
        readonly take: Binding['take'];
        readonly printed: string;
        readonly value: string | boolean;
        readonly column: { readonly name: string; readonly type: ValueType };
      })
    | (FromResult & {
        readonly take: Binding['take'];
        readonly image: { readonly hash: string; readonly assetVersion: string };
        readonly description: string;
        readonly column: { readonly name: string; readonly type: ImageColumnType };
      })
    | (FromResult & { readonly table: PrintedTable })
  )[];
}

/** Each value's record, in the order the binding stage set them. Throws on a version not held. */
export function publishedProvenance(
  values: readonly PrintedValue[],
  datasets: ReadonlyMap<string, HeldDataset>,
  numbering: NumberingTable,
): PublishedProvenance {
  const numbers = sectionNumbers(numbering);
  return {
    schemaVersion: PUBLISHED_PROVENANCE_VERSION,
    values: values.map((each) => {
      const held = datasets.get(each.datasetVersion);
      if (held === undefined) {
        throw new Error(`No dataset version ${each.datasetVersion} is held for ${each.binding}`);
      }
      const { provenance: p } = held;
      const from: FromResult = {
        node: each.node,
        number: numbers.get(each.node) ?? null,
        block: each.block,
        binding: each.binding,
        dataset: {
          id: held.id,
          name: held.name,
          version: each.datasetVersion,
          number: held.number,
        },
        result: {
          queryDefinition: {
            artifact: p.queryDefinition.artifact,
            version: p.queryDefinition.version,
          },
          parameters: p.parameters,
          identity: { kind: p.identity.kind },
          at: p.at,
          durationMs: p.durationMs,
          rowCount: p.rowCount,
          columns: p.columns.map((column) => ({ name: column.name, type: column.type })),
          canonical: p.canonical,
          checksum: p.checksum,
        },
      };
      if ('table' in each) {
        return {
          ...from,
          table: {
            columns: each.table.columns.map((column) => ({
              name: column.name,
              type: column.type,
              header: column.header,
              format: column.format,
            })),
            rows: each.table.rows.map((row) =>
              row.map((cell) => ({ printed: cell.printed, value: cell.value })),
            ),
            notes: each.table.notes.map(({ note, letter, row, column }) => ({
              note,
              letter,
              row,
              column,
            })),
          },
        };
      }
      if ('image' in each) {
        return {
          ...from,
          take: each.take,
          image: { hash: each.image.hash, assetVersion: each.image.assetVersion },
          description: each.description,
          column: { name: each.column.name, type: each.column.type },
        };
      }
      return {
        ...from,
        take: each.take,
        printed: each.printed,
        value: each.value,
        column: { name: each.column.name, type: each.column.type },
      };
    }),
  };
}

/** Its bytes: canonical JSON, keys sorted, UTF-8, so a remake is byte for byte the same. */
export function provenanceBytes(provenance: PublishedProvenance): Uint8Array {
  return new TextEncoder().encode(canonicalJson(provenance));
}
