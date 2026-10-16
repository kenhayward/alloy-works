import { carryForward } from '../metadata/carry.js';
import type { EffectiveField } from '../metadata/resolve.js';
import type { MetadataValues } from '../metadata/values.js';
import {
  parseOutlineDocument,
  walkOutline,
  type OutlineDocument,
  type OutlineMatter,
  type OutlineNode,
} from '../structure/outline.js';

import type { StartingSection, TemplateDefinition } from './definition.js';
import { requiredReference } from './materialise.js';
import { placeAtTop } from './placement.js';

/** A template version as a move reads it: its definition, and the fields it applies now (TE-K). */
export interface MoveSide {
  readonly definition: TemplateDefinition;
  readonly document: readonly EffectiveField[];
  readonly section: readonly EffectiveField[];
}

/** One field a move changes, at the document's level or a section's (TPL-058). */
export interface FieldChange {
  readonly level: 'document' | 'section';
  readonly field: string;
  readonly name: string;
  readonly change: 'added' | 'removed' | 'required' | 'optional';
}

/** What moving a document to a newer template version changes (TPL-034, TPL-058; WF6-D). */
export interface MoveReport {
  readonly theme: { readonly from: string; readonly to: string } | null;
  readonly layout: { readonly from: string; readonly to: string } | null;
  readonly fields: readonly FieldChange[];
  /** Each value the move would not carry forward: `node` null for the document's own (MET-036). */
  readonly notCarried: readonly {
    readonly node: string | null;
    readonly field: string;
    readonly name: string;
    readonly value: unknown;
  }[];
  /**
   * Each section and component the newer version requires that the document lacks, which the move adds
   * where the template places it (TPL-013, TPL-044; #660), unless the author declines it with a reason.
   */
  readonly adding: readonly {
    readonly kind: 'section' | 'component';
    readonly key: string;
    readonly title: string;
  }[];
}

export interface MovePlan {
  readonly report: MoveReport;
  /** The document's values carried forward to the newer version's fields. */
  readonly values: MetadataValues;
  /** The outline, each section's values carried forward; its sections otherwise as they are. */
  readonly outline: OutlineDocument;
}

function fieldChanges(
  level: FieldChange['level'],
  from: readonly EffectiveField[],
  to: readonly EffectiveField[],
): FieldChange[] {
  const before = new Map(from.map((each) => [each.field.id, each]));
  const after = new Map(to.map((each) => [each.field.id, each]));
  const changes: FieldChange[] = [];
  for (const each of to) {
    const was = before.get(each.field.id);
    const name = each.field.name;
    if (!was) changes.push({ level, field: each.field.id, name, change: 'added' });
    else if (was.required !== each.required) {
      changes.push({
        level,
        field: each.field.id,
        name,
        change: each.required ? 'required' : 'optional',
      });
    }
  }
  for (const each of from) {
    if (!after.has(each.field.id)) {
      changes.push({ level, field: each.field.id, name: each.field.name, change: 'removed' });
    }
  }
  return changes;
}

/**
 * TPL-033, TPL-034, TPL-058 (templates.md, "Moving forward"): what moving a document from one version
 * of its template to another makes and changes, read alike by the preview and the move. Values are
 * carried by `carryForward`, as every version carries them, the document's against the newer
 * version's document-level fields and each section's against its section-level ones; the outline's
 * sections are kept as they are, and a section the newer version requires that it lacks is reported.
 */
export function planTemplateMove(input: {
  readonly from: MoveSide;
  readonly to: MoveSide;
  readonly outline: OutlineDocument;
  readonly values: MetadataValues;
  readonly waived: ReadonlySet<string>;
  /** The keys the author declines to add, each to be recorded waived with its reason (#660). */
  readonly declined?: ReadonlySet<string>;
  readonly newIdentifier: () => string;
}): MovePlan {
  const { from, to } = input;
  const names = new Map(
    [...from.document, ...from.section].map((each) => [each.field.id, each.field.name]),
  );
  const notCarried: MoveReport['notCarried'][number][] = [];
  const documentCarried = carryForward(input.values, to.document);
  for (const each of documentCarried.notCarried) {
    notCarried.push({ node: null, ...each, name: names.get(each.field) ?? each.field });
  }
  const carrySections = (nodes: readonly OutlineNode[]): OutlineNode[] =>
    nodes.map((node) => {
      const children = carrySections(node.children);
      if (node.type !== 'section') return { ...node, children };
      const carried = carryForward(node.values, to.section);
      for (const each of carried.notCarried) {
        notCarried.push({ node: node.id, ...each, name: names.get(each.field) ?? each.field });
      }
      return { ...node, values: carried.values, children };
    });
  const carried = carrySections(input.outline.nodes);
  const { nodes, adding } = withRequired(carried, to, input);
  const outline = parseOutlineDocument({ ...input.outline, nodes });
  const differs = (a: string, b: string) => (a === b ? null : { from: a, to: b });
  return {
    report: {
      theme: differs(from.definition.theme, to.definition.theme),
      layout: differs(from.definition.layout, to.definition.layout),
      fields: [
        ...fieldChanges('document', from.document, to.document),
        ...fieldChanges('section', from.section, to.section),
      ],
      notCarried,
      adding,
    },
    values: documentCarried.values,
    outline,
  };
}

const titleOf = (section: StartingSection) =>
  section.title
    .map((inline) => (inline.type === 'text' ? inline.value : ''))
    .join('')
    .trim() || section.key;

/**
 * The outline with what the newer version newly requires added (TPL-013, TPL-044; #660): each required
 * starting section none of its sections came from, with its own required descendants, as making a
 * document writes one, at the end of the section its starting parent made where there is one, else at
 * the end of its matter's block at the top level; then each required component no reference came
 * from, where the template places it, a section this move adds among the places. Neither a key waived
 * already nor one the author declines is added.
 */
function withRequired(
  nodes: OutlineNode[],
  to: MoveSide,
  input: {
    readonly waived: ReadonlySet<string>;
    readonly declined?: ReadonlySet<string>;
    readonly newIdentifier: () => string;
  },
): { nodes: OutlineNode[]; adding: MoveReport['adding'][number][] } {
  const present = new Set<string>();
  walkOutline(nodes, (node) => {
    if (node.origin !== undefined) present.add(node.origin);
  });
  const skip = (key: string) =>
    present.has(key) || input.waived.has(key) || (input.declined?.has(key) ?? false);
  const adding: MoveReport['adding'][number][] = [];
  const values = carryForward({}, to.section).values;
  const build = (section: StartingSection): OutlineNode => {
    adding.push({ kind: 'section', key: section.key, title: titleOf(section) });
    return {
      type: 'section',
      id: input.newIdentifier(),
      title: section.title,
      origin: section.key,
      numbered: section.numbered,
      matter: section.matter,
      pageBreak: section.pageBreak,
      values,
      children: section.children.filter((each) => each.required && !skip(each.key)).map(build),
    } as OutlineNode;
  };
  // Mutable copies, so an addition can go inside a section the document already holds.
  let tree = structuredClone(nodes) as unknown as OutlineNode[];
  const sectionBy = (key: string) => {
    let found: OutlineNode | undefined;
    walkOutline(tree, (node) => {
      if (node.type === 'section' && node.origin === key) found = node;
    });
    return found;
  };
  const top: { matter: OutlineMatter; at: 'start' | 'end'; node: OutlineNode }[] = [];
  const walk = (sections: readonly StartingSection[], parent: string | null) => {
    for (const each of sections) {
      if (each.required && !skip(each.key)) {
        const node = build(each);
        const into = parent === null ? undefined : sectionBy(parent);
        if (into) (into.children as OutlineNode[]).push(node);
        else top.push({ matter: parent === null ? each.matter : 'body', at: 'end', node });
      } else walk(each.children, each.key);
    }
  };
  walk(to.definition.outline.sections, null);
  tree = placeAtTop(tree, top);
  top.length = 0;
  for (const each of to.definition.components ?? []) {
    if (skip(each.key)) continue;
    adding.push({ kind: 'component', key: each.key, title: each.key });
    const node = requiredReference(each, input.newIdentifier) as unknown as OutlineNode;
    const into = each.place.section === null ? undefined : sectionBy(each.place.section);
    if (into) {
      const children = into.children as OutlineNode[];
      if (each.place.at === 'start') children.unshift(node);
      else children.push(node);
    } else {
      top.push({
        matter: each.place.section === null ? (each.place.matter ?? 'body') : 'body',
        at: each.place.at,
        node,
      });
    }
  }
  // A section the move adds is in `tree` now, so a component placed in it is found by the same search.
  return { nodes: placeAtTop(tree, top), adding };
}
