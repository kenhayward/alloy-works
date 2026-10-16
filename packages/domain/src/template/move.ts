import { carryForward } from '../metadata/carry.js';
import type { EffectiveField } from '../metadata/resolve.js';
import type { MetadataValues } from '../metadata/values.js';
import type { OutlineDocument, OutlineNode } from '../structure/outline.js';

import { missingComponents, missingSections, type MissingSection } from './conformance.js';
import type { TemplateDefinition } from './definition.js';

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
  /** Each section the newer version requires that the document lacks, to add or waive (WF6-E). */
  readonly missing: readonly MissingSection[];
  /** Each component the newer version requires that the document lacks (TPL-044; the R9 final review). */
  readonly components: readonly { readonly key: string; readonly component: string }[];
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
  const outline = { ...input.outline, nodes: carrySections(input.outline.nodes) };
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
      missing: missingSections(to.definition, outline, input.waived),
      components: missingComponents(to.definition, outline, input.waived),
    },
    values: documentCarried.values,
    outline,
  };
}
