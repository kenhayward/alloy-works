import {
  conditions,
  documentTargets,
  number,
  resolve,
  walkOutline,
  type Contribution,
  type NumberingScheme,
  type OutlineView,
  type ReferenceTarget,
} from '@alloy-works/domain';
import type { ReferenceContext } from '@alloy-works/editor';

/**
 * **What each occurrence's references are shown against** (cross-references 1, rulings R11 and R12):
 * by occurrence node, `documentTargets` for that occurrence, numbered by the same pipeline a publish
 * numbers with, over the outline the page holds and the contributions it last heard. One map for the
 * text and for the editor opened in place, so a reference reads the same in the card and on the
 * surface it opens into. Without a scheme nothing is numbered, and every target is offered with no
 * label rather than with one a publication would not print. `words` is the layout's own for above and
 * below (cross-references 2, ruling R9), carried into every context alike so a relative reference
 * prints what a publish would, wherever in the document it stands. `component` is the occurrence's
 * own, so a reference naming its own component by a `component` target reads as a block of its own,
 * as a publish binds it (the final review of cross-references 2).
 *
 * **An occurrence's targets are computed when first asked for, and kept.** Each walks the whole
 * outline, so computing every occurrence's as the text is drawn costs the square of the document's
 * size - some sixty milliseconds of a five-hundred-node document's opening (W13.3) - and a
 * component's text asks only where it holds a reference, which most do not. `targetsOf` is
 * `documentTargets`, given here so a test can count the calls.
 */
export function referenceContexts(
  outline: OutlineView,
  scheme: NumberingScheme | null,
  contributions: ReadonlyMap<string, readonly Contribution[]>,
  words: { readonly above: string; readonly below: string } | null,
  targetsOf: typeof documentTargets = documentTargets,
): ReadonlyMap<string, ReferenceContext> {
  const numbering =
    scheme === null
      ? { scheme: '', entries: [] }
      : number(conditions(resolve(outline, contributions)), scheme);
  const contexts = new Map<string, ReferenceContext>();
  walkOutline(outline.nodes, (node) => {
    if (node.type !== 'reference' || node.component === null) return;
    const editing = { component: node.component, node: node.id };
    let targets: readonly ReferenceTarget[] | null = null;
    contexts.set(node.id, {
      get targets() {
        targets ??= targetsOf({ outline, numbering, contributions, editing });
        return targets;
      },
      component: node.component,
      ...(words === null ? {} : { words }),
    });
  });
  return contexts;
}
