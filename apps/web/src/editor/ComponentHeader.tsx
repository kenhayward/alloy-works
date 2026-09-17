import { contentDocumentSchema } from '@alloy-works/domain';
import { titleAccepted, type ComponentHeader as Header } from '@alloy-works/editor';
import { useState } from 'react';

import { DirectionSelect } from './DirectionSelect.js';

/** The same tag rule the model applies (see `NewComponent.tsx`, which reuses it for the same reason). */
const language = contentDocumentSchema.shape.language;

/**
 * What a field shows and what the document answered for it. `typed` is exactly what the author has in
 * front of them, `inModel` the value the document held the last time this field heard about it - so
 * the two can be compared against the document's own current value, which is the whole mechanism.
 */
interface Field {
  readonly typed: string;
  readonly inModel: string;
}

export interface ComponentHeaderProps {
  readonly header: Header;
  readonly editable: boolean;
  /**
   * Asks the editor to make a step, answering the header the document holds afterwards - or `null`
   * where there is no view to ask. The answer is what a field records as `inModel`, which is how a
   * value the model normalised (a trimmed title) stays distinguishable from one that changed
   * elsewhere.
   */
  readonly onChange: <K extends keyof Header>(member: K, value: Header[K]) => Header | null;
  readonly onRefused: (message: string) => void;
}

/**
 * The component's title, base language and base direction, above the surface
 * (component-editor.md, "Creating a component": each is edited afterwards in the component header).
 * A fragment, not its own `<header>` (S24): `ComponentEditor` already renders one, holding the
 * `Version … in …` paragraph beside the title, and this replaces only the heading inside it. Nesting
 * a second `<header>` there, or a second `id="component-title"`, would strand that paragraph and break
 * the article's `aria-labelledby`.
 *
 * Neither text field can be bound straight to the document. A title is stored trimmed
 * (packages/editor/src/header.ts), so a field mirroring the model back after every key would lose each
 * space the instant it became trailing: "Replace the toner" typed one character at a time arrives as
 * "Replacethetoner". A language tag is validated on every call, so a tag under construction - "f",
 * "fr-C" - would snap back to the old value on every keystroke and could never be finished at all.
 * Each field therefore holds what was typed.
 *
 * **What decides when a field resyncs is a value, never a render** (fix round 2, findings A-C). Each
 * field remembers the document's own value as it last heard it, `inModel`, and gives way only when the
 * document's value differs from that - which happens exactly when something other than this field
 * changed it: an undo, a refusal putting the surface back, a version cut. Everything else leaves the
 * field alone: the model normalising what this field just sent (which `onChange` answers with, so
 * `inModel` moves with it), a keystroke the model never saw because the tag is not finished, another
 * field's edit, or any of the page's routine re-renders - the claim resolving, each save's own
 * saving/saved transition, a phase change.
 *
 * The earlier attempt at this counted renders instead, through a ref set in a handler and cleared
 * during the next render. The application runs under `<StrictMode>` (apps/web/src/main.tsx), which
 * renders twice: the first pass cleared the flag and the second, finding it clear, resynced anyway -
 * so the fields ate keystrokes in the real application while the tests, which did not use StrictMode,
 * passed. Comparing values has no such pass to be on the wrong side of, and nothing here writes to a
 * ref during render.
 *
 * A refusal is not the same as a no-op: `setTitle` answers `false` both for a title it refuses and for
 * one the document already holds (retyping the current title with a trailing space, say). So the rule
 * is asked for directly - `titleAccepted`, exported beside the command it gates - rather than restated
 * here or inferred from the command's answer.
 *
 * **Both text fields say nothing while a value is being typed, only once the field is left.** For the
 * language that is because reporting a not-yet-complete tag on every keystroke both shouts about text
 * nobody has finished and never stops once they do, since nothing here un-reports it. For the title it
 * is the same reason wearing a worse hat (final review, finding 3): clearing the field to retype a
 * title used to report "A component needs a title." and put the document's own title back in the same
 * breath, so the message stood beside a perfectly good title and stayed there. A blur caused by the
 * field going read-only is not the author leaving, and reports nothing (fix round 2, finding H).
 *
 * **Leaving the title empty puts the document's title back; leaving a language tag half-typed does
 * not** (re-review, finding 1). The asymmetry is in what the two refusals leave behind. A refused tag
 * is text the author can see is wrong and can finish. An empty title is a field that never reached the
 * document at all, so `header.title` never changed, so the resync above never fires - and the empty
 * input would then survive a version cut and the surface going read-only, sitting beside a heading
 * showing the real title with nothing in the page able to correct it.
 */
export function ComponentHeader({ header, editable, onChange, onRefused }: ComponentHeaderProps) {
  const [title, setTitle] = useState<Field>({ typed: header.title, inModel: header.title });
  const [tag, setTag] = useState<Field>({ typed: header.language, inModel: header.language });

  // Adjusting state during render, the way React documents it for state derived from a prop: ordinary
  // state, so a second render pass under StrictMode reads what the first one set rather than undoing
  // it, and the comparison is by value, so the extra pass it schedules settles at once.
  if (header.title !== title.inModel) {
    setTitle({ typed: header.title, inModel: header.title });
  }
  if (header.language !== tag.inModel) {
    setTag({ typed: header.language, inModel: header.language });
  }

  return (
    <>
      <h2 id="component-title">{header.title}</h2>
      <label>
        Title
        <input
          value={title.typed}
          disabled={!editable}
          onChange={(event) => {
            const value = event.target.value;
            // Only a title the model would take is offered to it; a field on its way to a new title -
            // cleared, or nothing but spaces yet - is shown as typed and leaves the document alone,
            // exactly as an unfinished language tag does, so `inModel` stays what the document holds.
            // Asked once, outside the updater, which stays pure: StrictMode invokes an updater twice.
            const answered = titleAccepted(value) ? onChange('title', value) : null;
            setTitle((previous) => ({
              typed: value,
              inModel: answered?.title ?? previous.inModel,
            }));
          }}
          onBlur={() => {
            // As the language field, and for the same reason it is read-only-safe (finding H).
            if (!editable) return;
            if (titleAccepted(title.typed)) return;
            onRefused('A component needs a title.');
            // And put the document's title back, which the language field has no need to do
            // (re-review, finding 1). Clearing never reaches the document, so `header.title` never
            // changes and the comparison above never resyncs this field: left empty it would stay
            // empty through a version cut and through the surface going read-only, an empty input
            // beside a heading showing the real title, with nothing in the page able to put it right.
            setTitle({ typed: header.title, inModel: header.title });
          }}
        />
      </label>
      <label>
        Language
        <input
          value={tag.typed}
          disabled={!editable}
          onChange={(event) => {
            const value = event.target.value;
            // Only a complete tag is offered to the model; what is on the way there is shown as typed
            // and leaves the document alone, so `inModel` stays what the document still holds.
            const answered = language.safeParse(value).success ? onChange('language', value) : null;
            setTag((previous) => ({
              typed: value,
              inModel: answered?.language ?? previous.inModel,
            }));
          }}
          onBlur={() => {
            // Disabling a focused field blurs it in a real browser, and the header goes read-only
            // exactly when the surface does - the session lost, a version being cut. That blur is the
            // page changing under the author, not the author leaving an unfinished tag behind, and
            // reporting a refusal there writes over the notice that just said what happened.
            if (!editable) return;
            if (!language.safeParse(tag.typed).success) {
              onRefused('A language tag looks like en-GB.');
            }
          }}
        />
      </label>
      <label>
        Direction
        <DirectionSelect
          value={header.direction}
          disabled={!editable}
          onChange={(direction) => onChange('direction', direction)}
        />
      </label>
    </>
  );
}
