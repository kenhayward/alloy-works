import type { Binding } from '../data/binding.js';
import type { ColumnType, ImageColumnType, ValueType } from '../data/columns.js';
import type { ParameterValues } from '../data/parameters.js';
import type { Provenance } from '../data/provenance.js';
import { canonicalJson } from '../stored/canonical.js';
import { sectionNumbers, type NumberingTable } from '../structure/numbering.js';

import type { PrintedValue } from './bind.js';

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
  readonly take: Binding['take'];
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

/** The version every new `provenance.json` is written at: 2 since a value gained an image arm (B6-I). */
export const PUBLISHED_PROVENANCE_VERSION = 2;

/**
 * **`provenance.json`** (the B3 plan, B3-G; DAT-042, PUB-049): every value a publication printed,
 * where it stands - its node and that node's number, its block and its binding - what was printed and
 * the canonical value and column it was printed from, the take, the dataset by name and version, and
 * the result's provenance **built from an allow-list**: never the SQL that ran, the connection, or a
 * column's source, which only a reader of the definition may see, and nothing D3 adds later.
 *
 * **At `schemaVersion` 2** (the B6 plan, B6-I): a value may instead be an image, recorded by its hash
 * and the asset version it was placed as, with the description it was given - its text, or
 * `decorative`. Every new publication is written at 2; a file written at 1 stays as written.
 */
export interface PublishedProvenance {
  readonly schemaVersion: typeof PUBLISHED_PROVENANCE_VERSION;
  readonly values: readonly (
    | (FromResult & {
        readonly printed: string;
        readonly value: string | boolean;
        readonly column: { readonly name: string; readonly type: ValueType };
      })
    | (FromResult & {
        readonly image: { readonly hash: string; readonly assetVersion: string };
        readonly description: string;
        readonly column: { readonly name: string; readonly type: ImageColumnType };
      })
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
        take: each.take,
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
      if ('image' in each) {
        return {
          ...from,
          image: { hash: each.image.hash, assetVersion: each.image.assetVersion },
          description: each.description,
          column: { name: each.column.name, type: each.column.type },
        };
      }
      return {
        ...from,
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
