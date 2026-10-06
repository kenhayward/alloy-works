import { z } from 'zod';

import { artifactIdentifierSchema } from '../content/model/identifier.js';
import { MAX_COLUMNS } from './columns.js';
import { canonicalValueSchema, columnSchema, PARAMETER_NAME, type Column } from './definition.js';
import { MAX_LIST_ITEMS, type ParameterValues } from './parameters.js';
import { RAN_MAX_CHARACTERS } from './sql.js';
import { httpTemplateSchema, type HttpTemplate } from './http-template.js';
import { sourceNameSchema } from './protocol.js';

/**
 * A dataset version's content: its provenance record (data.md, "Storage of results and provenance";
 * DAT-085), in the arms D3 writes, D8's images, D7's person and D6's request: the request form of
 * `ran` arrived with D6, an arm added, refusing nothing stored. The result itself is an
 * object in the tenant's store under `checksum`, never in the record.
 */
export const PROVENANCE_SCHEMA_VERSION = 1;

/** An artifact at one of its versions. */
const versioned = z.strictObject({
  artifact: artifactIdentifierSchema,
  version: artifactIdentifierSchema,
});

/** An instant as `Date.prototype.toISOString` writes one, in UTC, and a real one. */
const instant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'an instant in UTC')
  .refine((value) => {
    const parsed = new Date(value);
    return (
      !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19)
    );
  }, 'a real instant');

const count = z.number().int().min(0);

/** A principal's id, as the platform's `principal` table holds it, lower case as 0047's key admits. */
const PRINCIPAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Who a run ran as: the connection's account, or a person's own role asserted at the source (D7-J). */
export type ProvenanceIdentity =
  | { readonly kind: 'service' }
  | {
      readonly kind: 'endUser';
      readonly mechanism: 'asserted';
      readonly principal: string;
      readonly signInRoute: 'organisation' | 'google' | 'token';
      readonly asSeen: string;
    };

export const provenanceSchema = z.strictObject({
  schemaVersion: z.literal(PROVENANCE_SCHEMA_VERSION),
  queryDefinition: versioned,
  connection: versioned,
  // The values that ran, by the definition's parameter names, as D2 checked them (D2-R).
  parameters: z.record(
    z.string().regex(PARAMETER_NAME),
    z.union([
      canonicalValueSchema,
      z
        .array(canonicalValueSchema.refine((value) => value !== null))
        .min(1)
        .max(MAX_LIST_ITEMS),
    ]),
  ),
  // The SQL the connector reports it ran, its values bound apart from it, or an HTTP request's
  // template, its values placed apart from it (the D6 plan, D6-L): never a secret, never a URL.
  ran: z.union([
    z.strictObject({ sql: z.string().min(1).max(RAN_MAX_CHARACTERS) }),
    z.strictObject({ request: httpTemplateSchema }),
  ]),
  identity: z.union([
    z.strictObject({ kind: z.literal('service') }),
    // A person's own view (the D7 plan, D7-J): whose, how they signed in, and the role the source saw.
    z.strictObject({
      kind: z.literal('endUser'),
      mechanism: z.literal('asserted'),
      principal: z.string().regex(PRINCIPAL),
      signInRoute: z.enum(['organisation', 'google', 'token']),
      asSeen: sourceNameSchema,
    }),
  ]),
  at: instant,
  durationMs: count,
  rowCount: count,
  columns: z.array(columnSchema).min(1).max(MAX_COLUMNS),
  canonical: z.literal(1),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  // Each image hash the result's cells hold, to the asset version admitted for it (D8-D).
  images: z.record(z.string().regex(/^[0-9a-f]{64}$/), artifactIdentifierSchema),
});

/** A dataset version's provenance, as D3 records it. */
export type Provenance = {
  readonly schemaVersion: 1;
  readonly queryDefinition: { readonly artifact: string; readonly version: string };
  readonly connection: { readonly artifact: string; readonly version: string };
  readonly parameters: ParameterValues;
  readonly ran: { readonly sql: string } | { readonly request: HttpTemplate };
  readonly identity: ProvenanceIdentity;
  readonly at: string;
  readonly durationMs: number;
  readonly rowCount: number;
  readonly columns: readonly Column[];
  readonly canonical: 1;
  readonly checksum: string;
  readonly images: Readonly<Record<string, string>>;
};

/** The shape alone: what a stored version is read back by. Throws on a record that is not one. */
export function parseProvenance(value: unknown): Provenance {
  return provenanceSchema.parse(value) as Provenance;
}

/** Every string a value holds, its members' names among them. */
function* strings(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const member of value) yield* strings(member);
  else if (typeof value === 'object' && value !== null) {
    for (const [name, member] of Object.entries(value)) {
      yield name;
      yield* strings(member);
    }
  }
}

/**
 * The shape, then what every write adds: every string already in NFC, since the version digest is
 * taken over the canonical form, which writes one so, and the row would otherwise hold a spelling its
 * digest was not taken over; and each column declared once. What `prepare` writes a dataset version by.
 */
export function parseProvenanceForWrite(value: unknown): Provenance {
  const provenance = parseProvenance(value);
  for (const text of strings(provenance)) {
    if (text !== text.normalize('NFC')) {
      throw new Error('A provenance record holds every string in NFC');
    }
  }
  const names = provenance.columns.map((column) => column.name);
  if (new Set(names).size !== names.length) {
    throw new Error('A provenance record declares each column once');
  }
  return provenance;
}
