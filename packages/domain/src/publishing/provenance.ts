import type { Binding } from '../data/binding.js';
import type { ColumnType, ValueType } from '../data/columns.js';
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

/**
 * **`provenance.json`** (the B3 plan, B3-G; DAT-042, PUB-049): every value a publication printed,
 * where it stands - its node and that node's number, its block and its binding - what was printed and
 * the canonical value and column it was printed from, the take, the dataset by name and version, and
 * the result's provenance **built from an allow-list**: never the SQL that ran, the connection, or a
 * column's source, which only a reader of the definition may see, and nothing D3 adds later.
 */
export interface PublishedProvenance {
  readonly schemaVersion: 1;
  readonly values: readonly {
    readonly node: string;
    readonly number: string | null;
    readonly block: string;
    readonly binding: string;
    readonly printed: string;
    readonly value: string | boolean;
    readonly column: { readonly name: string; readonly type: ValueType };
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
  }[];
}

/** Each value's record, in the order the binding stage set them. Throws on a version not held. */
export function publishedProvenance(
  values: readonly PrintedValue[],
  datasets: ReadonlyMap<string, HeldDataset>,
  numbering: NumberingTable,
): PublishedProvenance {
  const numbers = sectionNumbers(numbering);
  return {
    schemaVersion: 1,
    values: values.map((each) => {
      const held = datasets.get(each.datasetVersion);
      if (held === undefined) {
        throw new Error(`No dataset version ${each.datasetVersion} is held for ${each.binding}`);
      }
      const { provenance: p } = held;
      return {
        node: each.node,
        number: numbers.get(each.node) ?? null,
        block: each.block,
        binding: each.binding,
        printed: each.printed,
        value: each.value,
        column: { name: each.column.name, type: each.column.type },
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
    }),
  };
}

/** Its bytes: canonical JSON, keys sorted, UTF-8, so a remake is byte for byte the same. */
export function provenanceBytes(provenance: PublishedProvenance): Uint8Array {
  return new TextEncoder().encode(canonicalJson(provenance));
}
