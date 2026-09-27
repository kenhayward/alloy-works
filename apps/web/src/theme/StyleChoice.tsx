import type { Place, ResolvedTheme } from '@alloy-works/domain';
import {
  paragraphsAt,
  setImageStyle,
  setParagraphStyle,
  setTableStyle,
  type EditorView,
} from '@alloy-works/editor';
import { usePresentation } from './presentation.js';

/** One entry of a style list: the identifier stored, and the name an author reads. */
export interface Choice {
  readonly value: string;
  readonly label: string;
}

/**
 * The paragraph styles offered where these paragraphs stand (themes.md, ET-G; CNT-094): the places'
 * default first, stored as `body` so a paragraph moved elsewhere takes the default there (TH-E), then
 * every style that applies in every one of the places (STY-006), in the catalogue's order. A style
 * only a role takes - a heading, a caption - is never offered: the template sets those.
 */
export function paragraphChoices(theme: ResolvedTheme, places: readonly Place[]): Choice[] {
  const defaults = new Set(places.map((place) => theme.places[place]));
  const [only] = defaults;
  const named =
    defaults.size === 1 && only !== undefined ? theme.paragraphStyles.get(only) : undefined;
  const choices: Choice[] = [
    { value: 'body', label: named ? `${named.name} (default)` : 'Default' },
  ];
  for (const style of theme.paragraphStyles.values()) {
    if (style.id === 'body') continue;
    if (defaults.size === 1 && defaults.has(style.id)) continue;
    if (places.every((place) => style.appliesTo.includes(place))) {
      choices.push({ value: style.id, label: style.name });
    }
  }
  return choices;
}

/** The table styles offered for a table (CNT-094: a table is a block), in the catalogue's order. */
export function tableChoices(theme: ResolvedTheme): Choice[] {
  return [...theme.tableStyles.values()]
    .filter((style) => style.appliesTo.includes('table'))
    .map((style) => ({ value: style.id, label: style.name }));
}

/** The image styles offered for a figure or an image in a line (CNT-121), in the catalogue's order. */
export function imageChoices(theme: ResolvedTheme, target: 'figure' | 'inlineImage'): Choice[] {
  return [...theme.imageStyles.values()]
    .filter((style) => style.appliesTo.includes(target))
    .map((style) => ({ value: style.id, label: style.name }));
}

/**
 * A labelled style list. A value none of the choices holds - several paragraphs in different styles,
 * or a style the theme does not offer here - is shown as it is rather than as the first choice, so the
 * list never claims a style the text is not in.
 */
export function StyleSelect({
  label,
  value,
  choices,
  enabled,
  onChoose,
  className,
}: {
  label: string;
  value: string | null;
  choices: readonly Choice[];
  enabled: boolean;
  onChoose: (value: string) => void;
  className?: string | undefined;
}) {
  const known = value !== null && choices.some((choice) => choice.value === value);
  return (
    <label className={className}>
      {label}{' '}
      <select
        value={value ?? ''}
        disabled={!enabled}
        onChange={(event) => {
          if (event.target.value !== '') onChoose(event.target.value);
        }}
      >
        {value === null && (
          <option value="" disabled>
            Several styles
          </option>
        )}
        {value !== null && !known && <option value={value}>{value}</option>}
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * **Paragraph style**, beside the toolbar: the style of the paragraphs the selection touches, from the
 * styles that apply where they stand. Nothing until the theme has arrived, and nothing where the
 * selection touches no paragraph - a caption or a term has no style an author chooses.
 */
export function ParagraphStyle({
  view,
  enabled,
  className,
}: {
  view: EditorView;
  enabled: boolean;
  className?: string | undefined;
}) {
  const presentation = usePresentation();
  if (presentation?.state !== 'ready') return null;
  const paragraphs = paragraphsAt(view.state);
  if (paragraphs.length === 0) return null;
  const stored = new Set(paragraphs.map(({ node }) => node.attrs.style as string));
  const [only] = stored;
  return (
    <StyleSelect
      className={className}
      label="Paragraph style"
      value={stored.size === 1 && only !== undefined ? only : null}
      choices={paragraphChoices(presentation.theme, [
        ...new Set(paragraphs.map(({ place }) => place)),
      ])}
      enabled={enabled}
      onChoose={(style) => setParagraphStyle(style)(view.state, view.dispatch)}
    />
  );
}

/** **Table style**, in the Table panel. */
export function TableStyle({
  view,
  value,
  enabled,
}: {
  view: EditorView;
  value: string;
  enabled: boolean;
}) {
  const presentation = usePresentation();
  if (presentation?.state !== 'ready') return null;
  return (
    <StyleSelect
      label="Table style"
      value={value}
      choices={tableChoices(presentation.theme)}
      enabled={enabled}
      onChoose={(style) => setTableStyle(style)(view.state, view.dispatch)}
    />
  );
}

/** **Image style**, in the Figure panel, for a figure or an image in a line. */
export function ImageStyle({
  view,
  value,
  target,
  enabled,
}: {
  view: EditorView;
  value: string;
  target: 'figure' | 'inlineImage';
  enabled: boolean;
}) {
  const presentation = usePresentation();
  if (presentation?.state !== 'ready') return null;
  return (
    <StyleSelect
      label="Image style"
      value={value}
      choices={imageChoices(presentation.theme, target)}
      enabled={enabled}
      onChoose={(style) => setImageStyle(style)(view.state, view.dispatch)}
    />
  );
}
