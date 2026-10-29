import type { BridgePackage, ExtractionProvenance } from '@kenhayward/bridge-contract';

/** The structured fields and tables of a package (the contract names the schema, not the type). */
export type PackageData = NonNullable<BridgePackage['data']>;

/** A Postgres column type a delivered table takes. */
export type ColumnType = 'numeric' | 'bigint' | 'date' | 'timestamptz' | 'boolean' | 'text';

/** One table to create and fill: its safe name, its columns, and its rows as text (null for none). */
export type TablePlan = {
  name: string;
  columns: readonly { name: string; type: ColumnType }[];
  rows: readonly (string | null)[][];
};

export type TablePlanRefusal = { refused: 'name_conflict' | 'reserved_column'; detail: string };

const MAX_IDENTIFIER = 63;

/** The provenance columns 3ds-sink writes after each table's own, in its order (design, "Data tables"). */
const PROVENANCE: readonly { name: string; type: ColumnType }[] = [
  { name: 'ct_source_sha256', type: 'text' },
  { name: 'ct_source_filename', type: 'text' },
  { name: 'ct_job_id', type: 'text' },
  { name: 'ct_recipe_id', type: 'text' },
  { name: 'ct_recipe_version', type: 'bigint' },
  { name: 'ct_approved_by', type: 'text' },
  { name: 'ct_published_at', type: 'timestamptz' },
  { name: 'ct_row', type: 'bigint' },
];

/** Lower case `[a-z0-9_]`, at most 63 bytes (all ASCII, so 63 characters). Truncation can make two names one. */
function safe(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
  return (cleaned === '' ? '_' : cleaned).slice(0, MAX_IDENTIFIER);
}

/** A column name: safe, and not starting with a digit. */
function safeColumn(name: string): string {
  const cleaned = safe(name);
  return /^[0-9]/.test(cleaned) ? `_${cleaned}`.slice(0, MAX_IDENTIFIER) : cleaned;
}

function columnType(type: string): ColumnType {
  switch (type.toLowerCase().replace(/[^a-z]/g, '')) {
    case 'number':
      return 'numeric';
    case 'integer':
      return 'bigint';
    case 'date':
      return 'date';
    case 'datetime':
      return 'timestamptz';
    case 'boolean':
      return 'boolean';
    default:
      return 'text';
  }
}

function cell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * CT Studio's data to the Postgres tables a delivery writes (docs/design/ct-studio-sink.md, "Data
 * tables"): one per CT Studio table, `<tableSet>_<id>`, and `<tableSet>_fields`, each with the
 * provenance columns after its own. `tableSet` absent or empty is the recipe id. Two names that
 * become one refuse with `name_conflict` (never a suffix), and a column id starting `ct_` is
 * `reserved_column` (API-072).
 */
export function planTables(
  data: PackageData,
  provenance: ExtractionProvenance,
  tableSet: string | undefined,
): TablePlan[] | TablePlanRefusal {
  const set = safe(tableSet === undefined || tableSet === '' ? provenance.recipeId : tableSet);
  const provenanceCells = (row: number): (string | null)[] => [
    provenance.sourceSha256,
    provenance.sourceFilename,
    provenance.jobId,
    provenance.recipeId,
    String(provenance.recipeVersion),
    provenance.approver?.name ?? null,
    provenance.publishedAt,
    String(row),
  ];

  const plans: TablePlan[] = [];
  const names = new Map<string, string>();
  const claim = (name: string, source: string): TablePlanRefusal | undefined => {
    const first = names.get(name);
    if (first !== undefined) {
      return {
        refused: 'name_conflict',
        detail: `tableSet: ${first} and ${source} are both the table ${name}`,
      };
    }
    names.set(name, source);
    return undefined;
  };

  for (const table of data.tables) {
    const name = `${set}_${safe(table.id)}`.slice(0, MAX_IDENTIFIER);
    const conflict = claim(name, `table ${table.id}`);
    if (conflict) return conflict;

    const columns: { name: string; type: ColumnType }[] = [];
    const seen = new Map<string, string>();
    for (const column of table.columns) {
      const columnName = safeColumn(column.id);
      if (columnName.startsWith('ct_')) {
        return {
          refused: 'reserved_column',
          detail: `table ${table.id}: column ${column.id} starts ct_, which is reserved for provenance`,
        };
      }
      const first = seen.get(columnName);
      if (first !== undefined) {
        return {
          refused: 'name_conflict',
          detail: `table ${table.id}: columns ${first} and ${column.id} are both ${columnName}`,
        };
      }
      seen.set(columnName, column.id);
      columns.push({ name: columnName, type: columnType(column.type) });
    }
    const rows = table.rows.map((row, index) => [
      ...table.columns.map((column) => cell(row[column.id])),
      ...provenanceCells(index + 1),
    ]);
    plans.push({ name, columns: [...columns, ...PROVENANCE], rows });
  }

  const fieldsName = `${set}_fields`.slice(0, MAX_IDENTIFIER);
  const conflict = claim(fieldsName, 'the package fields');
  if (conflict) return conflict;
  plans.push({
    name: fieldsName,
    columns: [
      { name: 'id', type: 'text' },
      { name: 'title', type: 'text' },
      { name: 'type', type: 'text' },
      { name: 'value', type: 'text' },
      { name: 'unit', type: 'text' },
      ...PROVENANCE,
    ],
    rows: data.fields.map((field, index) => [
      field.id,
      field.title,
      field.type,
      cell(field.value),
      field.unit,
      ...provenanceCells(index + 1),
    ]),
  });
  return plans;
}
