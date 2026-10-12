/**
 * Resolved output compared (comparison.md; VER-024's third level, VER-031, VER-045; the CP plan,
 * CP-G): what a publish of each side would print, by node, and **why** each difference arose -
 * somebody edited, the data changed, a definition changed - and, for the whole document, its layout,
 * theme, template or the definitions it was validated against. Conditions are T4's: the identity until
 * then, so never a cause yet.
 */

/** One binding as a side prints it: the dataset version it holds, and its value in words. */
export interface ResolvedValue {
  readonly dataset: string | null;
  readonly printed: string | null;
}

/** One node as a side resolves it, as the caller may read it. */
export interface ResolvedNode {
  readonly component: string;
  readonly version: string;
  /** The definition versions the component version was written against (MET-017). */
  readonly definitions: readonly string[];
  /** Each binding it holds, by its identifier. */
  readonly values: ReadonlyMap<string, ResolvedValue>;
}

/** A side as a publish would make it: the pins, or the document now. */
export interface ResolvedSide {
  readonly layout: string;
  readonly theme: string;
  readonly template: string | null;
  /** The definition versions the document version was validated against (TPL-056). */
  readonly definitions: readonly string[];
  readonly nodes: ReadonlyMap<string, ResolvedNode>;
}

export type DocumentCause = 'layout' | 'theme' | 'template' | 'definition';
export type NodeCause = 'edited' | 'data' | 'definition';

export interface ResolvedComparison {
  /** What differs for the whole document. */
  readonly document: readonly DocumentCause[];
  /** Each node that prints differently, or would for a reason it names, in the newer side's order. */
  readonly nodes: readonly {
    readonly node: string;
    readonly causes: readonly NodeCause[];
    readonly values: readonly {
      readonly binding: string;
      readonly older: string | null;
      readonly newer: string | null;
    }[];
  }[];
}

const sameSet = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && [...left].sort().join('\n') === [...right].sort().join('\n');

/** Two resolved sides compared, each difference with its causes (VER-031, VER-045). */
export function compareResolved(older: ResolvedSide, newer: ResolvedSide): ResolvedComparison {
  const document: DocumentCause[] = [
    ...(older.layout !== newer.layout ? (['layout'] as const) : []),
    ...(older.theme !== newer.theme ? (['theme'] as const) : []),
    ...(older.template !== newer.template ? (['template'] as const) : []),
    ...(!sameSet(older.definitions, newer.definitions) ? (['definition'] as const) : []),
  ];
  const nodes: ResolvedComparison['nodes'][number][] = [];
  for (const [node, now] of newer.nodes) {
    const was = older.nodes.get(node);
    if (!was || was.component !== now.component) continue;
    const bindings = [...new Set([...was.values.keys(), ...now.values.keys()])].sort();
    const dataChanged = bindings.some(
      (binding) =>
        (was.values.get(binding)?.dataset ?? null) !== (now.values.get(binding)?.dataset ?? null),
    );
    const causes: NodeCause[] = [
      ...(was.version !== now.version ? (['edited'] as const) : []),
      ...(dataChanged ? (['data'] as const) : []),
      ...(!sameSet(was.definitions, now.definitions) ? (['definition'] as const) : []),
    ];
    const values = bindings.flatMap((binding) => {
      const before = was.values.get(binding)?.printed ?? null;
      const after = now.values.get(binding)?.printed ?? null;
      return before === after ? [] : [{ binding, older: before, newer: after }];
    });
    if (causes.length > 0 || values.length > 0) nodes.push({ node, causes, values });
  }
  return { document, nodes };
}
