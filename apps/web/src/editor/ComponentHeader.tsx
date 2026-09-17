import { contentDocumentSchema } from '@alloy-works/domain';
import type { ComponentHeader as Header } from '@alloy-works/editor';
import { useRef, useState } from 'react';

import { DirectionSelect } from './DirectionSelect.js';

/** The same tag rule the model applies (see `NewComponent.tsx`, which reuses it for the same reason). */
const language = contentDocumentSchema.shape.language;

export interface ComponentHeaderProps {
  readonly header: Header;
  readonly editable: boolean;
  /** Asked to make a step. What it answers is not used for anything - see the fields below. */
  readonly onChange: <K extends keyof Header>(member: K, value: Header[K]) => boolean;
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
 * The title input cannot be bound straight to `header.title`, because `setTitle` trims on every
 * single keystroke (packages/editor/src/header.ts). A trailing space is trimmed away the instant it
 * becomes trailing - so typing "Replace the toner" one character at a time, into a field that mirrors
 * the model back after every key, would arrive as "Replacethetoner": each space gone before the next
 * character can follow it. It therefore keeps its own buffer of exactly what was typed.
 *
 * That buffer is reconciled with the document - not left to seed once and go stale (review round 1,
 * item 1) - whenever the document's own title changes for a reason other than this very field's own
 * last edit: an undo (`Mod-z` makes a `DocAttrStep`, which reaches here through the ordinary
 * `dispatch` -> `header` state path) or `ComponentEditor`'s own `view.updateState` on a refusal
 * elsewhere in the session or a version cut (both now refresh `header` too, alongside the update).
 * `titleEditedHere` is set the instant the title field's own handler changes the buffer and consumed
 * on the very next render, so exactly the render that follows this field's own edit is left alone
 * (where the model's answer may legitimately differ from what was typed - trimmed) and every other
 * render resyncs from `header`.
 *
 * A refusal is distinguished from a harmless no-op by testing the value against the model's own rule
 * directly (review round 1, item 2), not by trusting `onChange`'s return value: `setTitle` also
 * answers `false` when the trimmed value already matches what the document holds - retyping the
 * current title with a trailing space, for instance - which is not a refusal and must not be reported
 * as one. Only a title that trims to nothing is refused; only that reverts the field, which is the
 * one case the field's own contract ("goes back to what the document says") is actually about.
 *
 * The language field keeps the same kind of buffer, for the same underlying reason: `setLanguage`
 * validates on every single keystroke, so a field bound straight to the model would snap back to the
 * old value on every one of a new tag's keystrokes that is not yet complete ("f", "fr-C"), making it
 * impossible to ever finish typing a new one. Unlike the title, though, it is not validated - or
 * reported - as it is typed at all, only once it is left (review round 1, item 3): reporting a
 * not-yet-complete tag on every keystroke both shouts about text nobody has finished typing and never
 * stops once they do, because nothing here ever un-reports it. `onChange` is asked to make a step only
 * for a value that already parses, so nothing intermediate ever reaches the document for the model to
 * answer back about; `onBlur` is what actually says whether what was left behind is refused.
 */
export function ComponentHeader({ header, editable, onChange, onRefused }: ComponentHeaderProps) {
  const [title, setLocalTitle] = useState(header.title);
  const [localLanguage, setLocalLanguage] = useState(header.language);
  const titleEditedHere = useRef(false);
  const languageEditedHere = useRef(false);

  if (titleEditedHere.current) titleEditedHere.current = false;
  else if (title !== header.title) setLocalTitle(header.title);

  if (languageEditedHere.current) languageEditedHere.current = false;
  else if (localLanguage !== header.language) setLocalLanguage(header.language);

  return (
    <>
      <h2 id="component-title">{header.title}</h2>
      <label>
        Title
        <input
          value={title}
          disabled={!editable}
          onChange={(event) => {
            const value = event.target.value;
            // The only way `setTitle` ever refuses (packages/editor/src/header.ts): trimmed to
            // nothing. Anything else either makes a step or is a no-op because it already matches -
            // neither is a refusal, so neither reports one nor reverts the field.
            if (value.trim() === '') {
              onRefused('A component needs a title.');
              setLocalTitle(header.title);
              return;
            }
            titleEditedHere.current = true;
            setLocalTitle(value);
            onChange('title', value);
          }}
        />
      </label>
      <label>
        Language
        <input
          value={localLanguage}
          disabled={!editable}
          onChange={(event) => {
            const value = event.target.value;
            // Guards the render this produces regardless of validity, not only an accepted one: most
            // of a new tag's own keystrokes are not yet valid on their own ("f", "fr-C"), and each one
            // still changes the buffer without changing `header.language` - which the resync check
            // above would otherwise read as an external change and revert, wiping out an in-progress
            // tag one not-yet-valid keystroke at a time.
            languageEditedHere.current = true;
            // Shown as typed regardless of validity: reverting it on every keystroke would make it
            // impossible to ever finish typing a new one.
            setLocalLanguage(value);
            if (language.safeParse(value).success) onChange('language', value);
          }}
          onBlur={() => {
            if (!language.safeParse(localLanguage).success) {
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
