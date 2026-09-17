import type { ComponentHeader as Header } from '@alloy-works/editor';
import { useState } from 'react';

export interface ComponentHeaderProps {
  readonly header: Header;
  readonly editable: boolean;
  /**
   * Asked to change one member. Answers false where the editor refused it, which is how the surface
   * learns that a title was emptied or a tag was not a tag.
   */
  readonly onChange: <K extends keyof Header>(member: K, value: Header[K]) => boolean;
  readonly onRefused: (message: string) => void;
}

/**
 * The component's title, base language and base direction, above the surface
 * (component-editor.md, "Creating a component": each is edited afterwards in the component header).
 * Each field asks the editor to make a step; a value the content model would refuse is not made, and
 * the field goes back to what the document says.
 *
 * A fragment, not its own `<header>` (S24): `ComponentEditor` already renders one, holding the
 * `Version … in …` paragraph beside the title, and this replaces only the heading inside it. Nesting
 * a second `<header>` there, or a second `id="component-title"`, would strand that paragraph and break
 * the article's `aria-labelledby`.
 *
 * Deviation from the brief (a defect it did not anticipate, corrected here rather than shipped): the
 * title and the language inputs cannot be bound straight to `header.title`/`header.language`, because
 * `setTitle` trims and `setLanguage` validates on every single keystroke (packages/editor/src/header.ts).
 * A trailing space is trimmed away the instant it becomes trailing - so typing "Replace the toner" one
 * character at a time, into a field that mirrors the model back after every key, arrives as
 * "Replacethetoner": each space is gone before the next character can follow it. The language field is
 * worse - a tag that is not yet complete ("f", "fr", "fr-C") is refused, and a field bound to the model
 * would snap straight back to the old value on every one of those keystrokes, so a new tag could never
 * be typed past its first character. Each field therefore keeps its own buffer of exactly what was
 * typed, seeded once from the document and never overwritten by the model's answer; only a refusal is
 * still reported, through `onRefused`, so the status region says why nothing was kept.
 */
export function ComponentHeader({ header, editable, onChange, onRefused }: ComponentHeaderProps) {
  const [title, setLocalTitle] = useState(header.title);
  const [language, setLocalLanguage] = useState(header.language);

  return (
    <>
      <h2 id="component-title">{header.title}</h2>
      <label>
        Title
        <input
          value={title}
          disabled={!editable}
          onChange={(event) => {
            setLocalTitle(event.target.value);
            if (!onChange('title', event.target.value)) onRefused('A component needs a title.');
          }}
        />
      </label>
      <label>
        Language
        <input
          value={language}
          disabled={!editable}
          onChange={(event) => {
            setLocalLanguage(event.target.value);
            if (!onChange('language', event.target.value)) {
              onRefused('A language tag looks like en-GB.');
            }
          }}
        />
      </label>
      <label>
        Direction
        <select
          value={header.direction}
          disabled={!editable}
          onChange={(event) => onChange('direction', event.target.value === 'rtl' ? 'rtl' : 'ltr')}
        >
          <option value="ltr">Left to right</option>
          <option value="rtl">Right to left</option>
        </select>
      </label>
    </>
  );
}
