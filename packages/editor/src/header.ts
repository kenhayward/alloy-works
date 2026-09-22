import { contentDocumentSchema, hasText } from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';

/** The component's header as the editor holds it: the root's members other than the blocks. */
export interface ComponentHeader {
  readonly title: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
}

/** What the document says now, for a surface that has to show it. */
export function headerOf(doc: Node): ComponentHeader {
  return {
    title: doc.attrs.title as string,
    language: doc.attrs.language as string,
    direction: doc.attrs.direction as ComponentHeader['direction'],
  };
}

/**
 * Sets an attribute of the root as a step - `DocAttrStep`, through `Transform.setDocAttribute` - so it
 * joins the same history the content is in, makes the document changed, and travels in the whole
 * content document the session already sends (component-editor.md, "The surface": each is saved,
 * undoable and versioned like content).
 */
const setRoot =
  (attribute: keyof ComponentHeader, value: string): Command =>
  (state, dispatch) => {
    if (state.doc.attrs[attribute] === value) return false;
    dispatch?.(state.tr.setDocAttribute(attribute, value));
    return true;
  };

/**
 * Whether the model would take this as a title at all - the rule `setTitle` enforces below, asked
 * without a document (fix round 2). A field that shows a title as it is typed has to tell a refusal
 * from a value the document already holds, because the command answers `false` to both; asking the
 * rule here keeps it in one place rather than restating it in the renderer, where it would rot
 * silently the day this rule changes. It is the domain's `hasText` itself, so the store holds an
 * outline's titles to the very function the editor gates a component's with.
 */
export const titleAccepted = hasText;

/**
 * A title the content model would refuse is refused here instead, without dispatching: the document
 * must never reach a state `fromEditor` cannot serialise, because the session takes its snapshot
 * inside the save path where nothing is waiting to catch a throw. The same rule as the editor's other
 * invariants (ADR-0023, and editor 1's decision 5).
 *
 * Stored trimmed - the same agreement `createComponent` holds at creation
 * (`packages/db/src/creation.ts`): a title that is empty after trimming is refused, and what is set is
 * the trimmed form, never the untrimmed one. Trimming only to decide refusal and then setting the
 * untrimmed string would let a component's title carry leading or trailing whitespace that creation
 * itself would never have stored, which is the asymmetry this avoids. Saving an iteration refuses a
 * title that trims to nothing too (`apps/service/src/editing.ts`, issue #116), so no client bypassing
 * this editor can store one either.
 */
export const setTitle =
  (title: string): Command =>
  (state, dispatch) =>
    titleAccepted(title) ? setRoot('title', title.trim())(state, dispatch) : false;

/**
 * As `setTitle`, for the base language (CNT-140). The rule comes from the domain, the same schema
 * `parseContentDocument` checks it with, so the editor and creation share one rule rather than two.
 */
export const setLanguage =
  (language: string): Command =>
  (state, dispatch) =>
    contentDocumentSchema.shape.language.safeParse(language).success
      ? setRoot('language', language)(state, dispatch)
      : false;

/** As `setTitle`, for the base direction (CNT-059). The enum is the model's, so there is no bad value. */
export const setDirection = (direction: ComponentHeader['direction']): Command =>
  setRoot('direction', direction);
