import {
  bindingDigestInput,
  bindingNodeSchema,
  formatsFor,
  formatValue,
  takeOutcomeSchema,
  valueTypeSchema,
  type Binding,
  type ResolvedTheme,
  type TakeOutcome,
  type ValueFormats,
  type ValueType,
} from '@alloy-works/domain';
import type { BindingContext, BindingFailureHeld, BindingHeld } from '@alloy-works/editor';

/**
 * What the bindings view says of one binding, as this page reads it (the B1 plan, B1-I): checked
 * member by member, as every body the client hands back is, since its types are `any` underneath.
 */

/**
 * An image a take gave, as the view answers it (the B6 plan, B6-G): with the asset version the result's
 * provenance admitted it as, whose bytes the page draws.
 */
export type TakenImage = Extract<TakeOutcome, { readonly image: unknown }> & {
  readonly assetVersion: string;
};

/** Why an image cannot stand where its binding is placed, as the view decides it (B6-D). */
export type PlacementFailure = 'value_not_image' | 'image_not_placeable';

const PLACEMENT_FAILURES: readonly unknown[] = ['value_not_image', 'image_not_placeable'];

/**
 * What a take gave where its binding is placed - a value, an image with its asset version, or why
 * there is none, its placement among the reasons - or that the result could not be read (B1-H).
 */
export type Taken =
  | Exclude<TakeOutcome, { readonly image: unknown }>
  | TakenImage
  | { readonly failure: PlacementFailure }
  | { readonly unavailable: true };

/** A provenance record as the view shows it: what only a definition's reader may see is null. */
export interface ProvenanceShown {
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly sql: string | null;
  readonly identity: string;
  /** Whose own view it is, where it ran as a person (the D7 plan, D7-J); else null. */
  readonly principal?: string | null;
  readonly at: string;
  readonly rowCount: number;
  readonly checksum: string;
}

export interface BindingState {
  readonly node: string;
  readonly binding: Binding;
  readonly held: {
    readonly dataset: string;
    readonly version: string;
    readonly number: string;
    readonly provenance: ProvenanceShown;
    readonly name: string | null;
    readonly stale: boolean;
    readonly taken: Taken | null;
    readonly act: 'resolve' | 'accept' | 'confirm';
    /** Whether Keep may hold it under the binding as it now stands (B2-G). */
    readonly keepable: boolean;
    readonly by: { readonly id: string; readonly displayName: string | null };
    readonly at: string;
  } | null;
  readonly waiting: {
    readonly version: string;
    readonly provenance: ProvenanceShown;
    readonly taken: Taken | null;
  } | null;
  readonly definition: { readonly title: string; readonly version: string } | null;
  readonly connection: { readonly name: string } | null;
  /** Floating, and its definition has moved on from the version its held result ran (DAT-070). */
  readonly definitionChanged: boolean;
  /** How it differs from what the document's latest publication printed, or null (B4-D). */
  readonly sincePublished: 'new' | readonly SinceDiffers[] | null;
  /** Whether a check would look for a revision of it for this reader (B4-F). */
  readonly mayCheck: boolean;
  /** Whether this reader may resolve it. */
  readonly mayResolve: boolean;
  /**
   * Where what the view answered of what it holds, or of what waits, does not read: it is shown
   * unavailable, with no provenance to open, never as one never resolved.
   */
  readonly unread?: true;
}

/** What may differ from the latest publication: the binding itself, the result, the definition. */
export type SinceDiffers = 'digest' | 'dataset' | 'definition';

const SINCE: readonly string[] = ['digest', 'dataset', 'definition'];

function sinceIn(value: unknown): BindingState['sincePublished'] {
  if (value === 'new') return 'new';
  if (!Array.isArray(value) || value.length === 0) return null;
  const differs = value.filter((each): each is SinceDiffers => SINCE.includes(each as string));
  return differs.length > 0 ? differs : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

function takenIn(value: unknown): Taken | null {
  if (!isRecord(value)) return null;
  if (value.unavailable === true) return { unavailable: true };
  if (PLACEMENT_FAILURES.includes(value.failure) && Object.keys(value).length === 1) {
    return { failure: value.failure as PlacementFailure };
  }
  // An image is a take's, beside the asset version the view adds to it (B6-G).
  const { assetVersion, ...outcome } = value;
  const parsed = takeOutcomeSchema.safeParse(outcome);
  if (!parsed.success) return null;
  if (!('image' in parsed.data)) return assetVersion === undefined ? parsed.data : null;
  return typeof assetVersion === 'string' ? { ...parsed.data, assetVersion } : null;
}

function provenanceIn(value: unknown): ProvenanceShown | undefined {
  if (!isRecord(value) || !isRecord(value.ran) || !isRecord(value.identity)) return undefined;
  const { at, rowCount, checksum, parameters } = value;
  // What ran, in words: SQL as it ran, or an S3 object by its bucket and key; an HTTP request's
  // template is the definition's to show (the D6 plan, D6-L). Null where the caller may not read it.
  const { object } = value.ran;
  const sql =
    isRecord(object) && typeof object.bucket === 'string' && typeof object.key === 'string'
      ? `${object.bucket}/${object.key}`
      : 'request' in value.ran
        ? null
        : value.ran.sql;
  const identity = text(value.identity.kind);
  if (typeof at !== 'string' || typeof rowCount !== 'number' || typeof checksum !== 'string') {
    return undefined;
  }
  if (identity === undefined || (sql !== null && typeof sql !== 'string')) return undefined;
  return {
    parameters: isRecord(parameters) ? parameters : {},
    sql,
    identity,
    principal: text(value.identity.principal) ?? null,
    at,
    rowCount,
    checksum,
  };
}

function heldIn(value: unknown): BindingState['held'] | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isRecord(value.by)) return undefined;
  const provenance = provenanceIn(value.provenance);
  const [dataset, version, number, at, by] = [
    text(value.dataset),
    text(value.version),
    text(value.number),
    text(value.at),
    text(value.by.id),
  ];
  if (!provenance || !dataset || !version || !number || !at || !by) return undefined;
  if (typeof value.stale !== 'boolean') return undefined;
  if (value.act !== 'resolve' && value.act !== 'accept' && value.act !== 'confirm')
    return undefined;
  return {
    dataset,
    version,
    number,
    provenance,
    name: text(value.name) ?? null,
    stale: value.stale,
    taken: takenIn(value.taken),
    act: value.act,
    keepable: value.keepable === true,
    by: { id: by, displayName: text(value.by.displayName) ?? null },
    at,
  };
}

function waitingIn(value: unknown): BindingState['waiting'] | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const provenance = provenanceIn(value.provenance);
  const version = text(value.version);
  if (!provenance || !version) return undefined;
  return { version, provenance, taken: takenIn(value.taken) };
}

/**
 * The bindings a `DocumentBindingsView` holds, each read member by member: one whose node or binding
 * does not read is left out, and shows what it would with no value known; one whose `held` or `waiting`
 * does not read is `unread`, and shows its value unavailable. `undefined` is a body that is not the view.
 */
export function bindingStatesIn(data: unknown): readonly BindingState[] | undefined {
  if (!isRecord(data) || !Array.isArray(data.bindings)) return undefined;
  return (data.bindings as unknown[]).flatMap((each): BindingState[] => {
    if (!isRecord(each) || typeof each.node !== 'string') return [];
    const binding = bindingNodeSchema.safeParse(each.binding);
    const held = heldIn(each.held);
    const waiting = waitingIn(each.waiting);
    if (!binding.success) return [];
    const definition =
      isRecord(each.definition) &&
      typeof each.definition.title === 'string' &&
      typeof each.definition.version === 'string'
        ? { title: each.definition.title, version: each.definition.version }
        : null;
    const connection =
      isRecord(each.connection) && typeof each.connection.name === 'string'
        ? { name: each.connection.name }
        : null;
    const facts = {
      definitionChanged: each.definitionChanged === true,
      sincePublished: sinceIn(each.sincePublished),
      mayCheck: each.mayCheck === true,
      mayResolve: each.mayResolve === true,
    };
    if (held === undefined || waiting === undefined) {
      return [
        {
          node: each.node,
          binding: binding.data,
          held: null,
          waiting: null,
          definition,
          connection,
          ...facts,
          unread: true,
        },
      ];
    }
    return [
      { node: each.node, binding: binding.data, held, waiting, definition, connection, ...facts },
    ];
  });
}

/** Whether a component's content holds a binding anywhere: what the page asks the view for. */
export function holdsBinding(content: unknown): boolean {
  if (Array.isArray(content)) return content.some(holdsBinding);
  if (!isRecord(content)) return false;
  if (content.type === 'binding') return true;
  return Object.values(content).some(holdsBinding);
}

/**
 * A taken value as the document shows it: formatted by its theme's formats (B1-G). An image (B6) is
 * said by its description, which a copy's plain text and the Value panel write; the page draws it.
 */
export function shownValue(
  taken: Extract<TakeOutcome, { readonly value: unknown } | { readonly image: unknown }>,
  formats: ValueFormats,
): string {
  if ('image' in taken) {
    return decorative(taken) ? 'A decorative image' : `An image: ${taken.description}`;
  }
  return formatValue(taken.value, taken.column.type, formats);
}

/** Whether an image is decorative: by its column's type, never by its words (B6-C). */
const decorative = (taken: Extract<TakeOutcome, { readonly image: unknown }>): boolean =>
  taken.column.type.description === 'decorative';

/** A value's type, read where the view gives it. */
export const typeOf = (type: unknown): ValueType | null => {
  const parsed = valueTypeSchema.safeParse(type);
  return parsed.success ? parsed.data : null;
};

/**
 * Never `bindingDigestInput`'s spelling of any binding, so a resolution held for a binding that has
 * changed since compares unequal with the binding as the editor holds it, which then says it changed
 * since it was resolved (B1-J): the view does not answer the binding it was resolved for.
 */
const CHANGED = '';

/** What one binding shows, from what the document holds for it. */
function heldOf(state: BindingState, formats: ValueFormats): BindingHeld | null {
  const { held } = state;
  if (state.unread) {
    return {
      binding: bindingDigestInput(state.binding),
      shown: { failure: 'unavailable' },
      unread: true,
    };
  }
  if (held === null) return null;
  if (held.stale) return { binding: CHANGED, shown: { failure: 'unavailable' } };
  const binding = bindingDigestInput(state.binding);
  const { taken } = held;
  if (taken === null || 'unavailable' in taken) {
    return { binding, shown: { failure: 'unavailable' } };
  }
  if ('value' in taken) {
    return {
      binding,
      shown: { value: shownValue(taken, formats), waiting: state.waiting !== null },
    };
  }
  if ('image' in taken) {
    return {
      binding,
      shown: {
        value: shownValue(taken, formats),
        waiting: state.waiting !== null,
        image: { asset: taken.assetVersion, alt: decorative(taken) ? '' : taken.description },
      },
    };
  }
  return { binding, shown: failureHeld(taken, state.binding) };
}

/** A take's failure as the editor's words for it read it: the column from the binding where unsaid. */
export function failureHeld(
  taken: Extract<Taken, { readonly failure: unknown }>,
  binding: Binding,
): BindingFailureHeld {
  if (!('column' in taken || 'count' in taken) && PLACEMENT_FAILURES.includes(taken.failure)) {
    return { failure: taken.failure as PlacementFailure };
  }
  const failed = taken as Extract<TakeOutcome, { readonly failure: unknown }>;
  if (failed.failure === 'image_description_missing') {
    return { failure: 'image_description_missing', column: failed.column ?? binding.take.column };
  }
  return failed.failure === 'take_invalid'
    ? { failure: 'take_invalid', column: failed.column ?? binding.take.column }
    : {
        failure: failed.failure,
        ...(failed.count === undefined ? {} : { count: failed.count }),
      };
}

/**
 * **What each occurrence's bindings are shown against** (the B1 plan, B1-D, B1-J), by occurrence node,
 * pure, as `referenceContexts` is: what the document holds for each binding the view answered there,
 * each value formatted by `formatValue` in the theme's formats for the document's language
 * (`formatsFor`), the product's default where the theme names none or has not arrived. An occurrence
 * the view answered for holds a context even where none of its bindings was ever resolved, so each
 * says so in place; the read text and the editor opened in place take the same one.
 */
export function bindingContexts(
  states: readonly BindingState[],
  theme: ResolvedTheme | null,
  language: string | null,
): ReadonlyMap<string, BindingContext> {
  const formats = formatsFor(theme?.valueCatalogue ?? null, language);
  const held = new Map<string, Map<string, BindingHeld>>();
  for (const state of states) {
    const at = held.get(state.node) ?? new Map<string, BindingHeld>();
    held.set(state.node, at);
    const shown = heldOf(state, formats);
    if (shown !== null) at.set(state.binding.id, shown);
  }
  return new Map(
    [...held].map(([node, each]) => [node, { kind: 'document', held: each, node } as const]),
  );
}

/** Each occurrence's binding states by binding, for its Value panel and its provenance. */
export function statesByNode(
  states: readonly BindingState[],
): ReadonlyMap<string, ReadonlyMap<string, BindingState>> {
  const by = new Map<string, Map<string, BindingState>>();
  for (const state of states) {
    const at = by.get(state.node) ?? new Map<string, BindingState>();
    by.set(state.node, at);
    at.set(state.binding.id, state);
  }
  return by;
}
