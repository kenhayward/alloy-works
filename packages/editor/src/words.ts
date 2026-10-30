/**
 * **The words the editor says** (the UI plan, UIb; LOC-027): each a whole ICU message in English,
 * keyed. The renderer gives its own through `sayWith`, the catalogue's `pm.<key>` in the person's
 * language, which it makes from this table; with none given, as in this package's tests, English.
 * A list goes through `listOf`, so it is joined as the language joins one.
 */
export const EDITOR_WORDS = {
  'footnote.mark': 'Footnote',
  'footnote.text': 'Footnote text',
  'equation.numbered': 'Numbered',
  'equation.no-description': 'No description',
  'equation.unshown': 'An equation that cannot be shown',
  'figure.missing-image': 'An image you may not see',
  'citation.placeholder': 'Citation',
  'citation.unavailable': 'Citation unavailable',
  'citation.flagged': 'Its source says it is {flag}',
  'index.chip': 'Index: {entry}',
  'index.prints-nothing': '(prints nothing)',
  'index.chip-title': 'Index entry {entry}. It prints nothing where it stands.',
  'condition.only-where': 'Only where {axis} is {values}',
  'reference.placeholder': 'Reference',
  'reference.broken': 'Broken reference',
  'reference.broken-section': 'Broken reference to a section',
  'reference.broken-component': 'Broken reference to another component',
  'reference.in-another-component': 'In another component',
  'reference.not-numbered': '{kind} not numbered - choose another form',
  'reference.title-holds-equation': '{kind} title holds an equation - choose another form',
  'reference.no-number': '{kind} has no number - choose another form',
  'reference.no-title': '{kind} has no title - choose another form',
  'reference.cannot-show': '{kind} cannot be shown this way - choose another form',
  'style.missing':
    '{kind, select, table {Table style} image {Image style} other {Style}} {style} is not in this theme',
  'style.misplaced':
    '{kind, select, table {Table style} image {Image style} other {Style}} {style} does not apply here',
  'glyph.missing': 'No glyph for {codes} in this typeface',
  'glyph.missing-in-label': 'No glyph for {codes} in this typeface, in its label',
  'term.suggested': 'Suggested terms',
  'term.offered':
    '{count, plural, one {Term offered: {term}. Tab to apply, Escape to dismiss.} other {# terms offered: {term}. Tab to apply, the arrows and Enter to choose, Escape to dismiss.}}',
  'term.unavailable': 'Term unavailable',
  'term.deprecated': 'Deprecated',
  'term.deprecated-use': 'Deprecated: use {term}',
  'binding.bound-value': 'Bound value',
  'binding.bound-image': 'Bound image',
  'binding.bound-table': 'Bound table',
  'binding.never-resolved': 'No value - never resolved',
  'binding.changed-since-resolved': 'No value - the binding changed since it was resolved',
  'binding.revision-waiting': 'revision waiting',
  'binding.revised-by-hand': 'revised by hand',
  'binding.a-bound-value': 'a bound value',
  'binding.asks-for-where': '{column} where {key}',
  'binding.key-is': '{column} is {value}',
  'binding.alone': '{asks}, {title}',
  'binding.kind': ', bound value',
  'binding.kind-alone': ', bound value, a value in each document',
  'binding.kind-failed': ', bound value, failed',
  'binding.take-invalid': 'No value - the definition has no column {column}',
  'binding.value-none': 'No value - the query returned no rows',
  'binding.value-many':
    '{count, select, several {No value - the query returned several rows} other {No value - the query returned {count} rows}}',
  'binding.row-missing': 'No value - no row',
  'binding.row-missing-where': 'No value - no row where {key}',
  'binding.value-empty': 'No value - empty',
  'binding.unavailable': 'No value - the result cannot be read',
  'binding.image-description-missing': 'No image - the row has no description in {column}',
  'binding.value-not-image': 'No image - the column is not an image',
  'binding.image-not-placeable': 'No image - a footnote or a caption cannot hold one',
  'message-form.varies-by-number': 'Words varying by a number',
  'binding.value-not-number': 'No number - a message form varies by a number, and this column holds none',
  'bound-table.never-resolved': 'No rows - never resolved',
  'bound-table.changed': 'No rows - the binding changed since it was resolved',
  'bound-table.unavailable': 'No rows - the result cannot be read',
  'bound-table.reading': 'Reading the rows',
  'bound-table.column-missing': 'No rows - the result has no column {column}',
  'bound-table.column-image': 'No rows - {column} is an image column, which a table cannot show',
  'bound-table.format-mismatch':
    'No rows - the format of {column} sets {detail}, which does not apply to its values',
  'bound-table.too-long': 'No rows - the result has {count} rows, more than a table prints',
  'bound-table.subtotal-not-boolean':
    'No rows - {column} marks subtotals, so it must hold true or false',
  'bound-table.transpose-too-long':
    'No rows - the result has {count} rows, more than a table turns on its side',
  'bound-table.subtotal-ambiguous':
    'No rows - row {row, number} of the result is a subtotal at two levels',
  'bound-table.note-key-required':
    'Its query definition declares no key, so this note cannot name its row',
  'bound-table.note-row-missing': 'No row has the key {key} now',
  'bound-table.key-value': '{column} {value}',
  'bound-table.alone': 'Filled from {title} in each document',
  'bound-table.alone-untitled': 'Filled from a query definition in each document',
  'bound-table.more-rows': '{count, plural, one {and # more row} other {and # more rows}}',
  'bound-table.cell-revised': ', revised by hand',
  'command.strong': 'Strong',
  'command.strong.keys': 'Ctrl or Cmd and B',
  'command.emphasis': 'Emphasis',
  'command.emphasis.keys': 'Ctrl or Cmd and I',
  'command.underline': 'Underline',
  'command.underline.keys': 'Ctrl or Cmd and U',
  'command.subscript': 'Subscript',
  'command.subscript.keys': 'Ctrl or Cmd and comma',
  'command.superscript': 'Superscript',
  'command.superscript.keys': 'Ctrl or Cmd and full stop',
  'command.inlineCode': 'Inline code',
  'command.inlineCode.keys': 'Ctrl or Cmd and E',
  'command.quotedPhrase': 'Quoted phrase',
  'command.quotedPhrase.keys': 'Ctrl or Cmd, Shift and Q',
  'command.hyperlink': 'Link',
  'command.hyperlink.keys': 'Ctrl or Cmd and K',
  'command.language': 'Language',
  'command.language.keys': 'Ctrl or Cmd, Shift and L',
  'command.definedTerm': 'Term',
  'command.definedTerm.keys': 'Ctrl or Cmd, Alt and G',
  'command.bulletedList': 'Bulleted list',
  'command.bulletedList.keys': 'Ctrl or Cmd, Shift and 8',
  'command.numberedList': 'Numbered list',
  'command.numberedList.keys': 'Ctrl or Cmd, Shift and 7',
  'command.definitionList': 'Definition list',
  'command.definitionList.keys': 'Ctrl or Cmd, Shift and 9',
  'command.nestItem': 'Nest item',
  'command.nestItem.keys': 'Ctrl or Cmd and right square bracket',
  'command.liftItem': 'Lift item',
  'command.liftItem.keys': 'Ctrl or Cmd and left square bracket',
  'command.quotation': 'Quotation',
  'command.quotation.keys': 'Ctrl or Cmd, Shift and full stop',
  'command.preformatted': 'Preformatted text',
  'command.preformatted.keys': 'Ctrl or Cmd, Shift and comma',
  'command.table': 'Table',
  'command.table.keys': 'Ctrl or Cmd, Shift and 0',
  'command.footnote': 'Footnote',
  'command.footnote.keys': 'Ctrl or Cmd, Alt and F',
  'command.reference': 'Reference',
  'command.reference.keys': 'Ctrl or Cmd, Alt and X',
  'command.cite': 'Cite',
  'command.cite.keys': 'Ctrl or Cmd, Shift and 2',
  'command.indexEntry': 'Index entry',
  'command.indexEntry.keys': 'Ctrl or Cmd, Shift and 1',
  'command.value': 'Value',
  'command.value.keys': 'Ctrl or Cmd, Shift and 6',
  'command.variable': 'Variable',
  'command.variable.keys': 'Ctrl or Cmd, Alt and V',
  'command.condition': 'Condition',
  'command.condition.keys': 'Ctrl or Cmd, Alt and O',
  'command.equation': 'Equation',
  'command.equation.keys': 'Ctrl or Cmd, Shift and E',
  'command.symbol': 'Symbols',
  'command.symbol.keys': 'Ctrl or Cmd, Shift and M',
} as const;

export type EditorWordKey = keyof typeof EDITOR_WORDS;
export type EditorWordValues = Readonly<Record<string, string | number>>;

/** What the renderer gives: its words by key, and a list joined in the person's language. */
export interface EditorSaying {
  readonly words: (key: EditorWordKey, values?: EditorWordValues) => string;
  readonly list: (
    values: readonly string[],
    type: 'conjunction' | 'disjunction' | 'unit',
  ) => string;
}

/**
 * English filled in place: `{name}`, `{name, number}`, and one level of `plural` or `select` whose
 * branches hold `{name}` and `#`. Enough for this table, which the test holds to.
 */
function english(message: string, values: EditorWordValues = {}): string {
  const choice = /\{(\w+), (plural|select), /.exec(message);
  if (choice) {
    const [opening, name, kind] = choice as unknown as string[];
    let end = choice.index + opening!.length;
    for (let depth = 1; depth > 0; end++) {
      if (message[end] === '{') depth++;
      if (message[end] === '}') depth--;
    }
    const before = message.slice(0, choice.index);
    const body = message.slice(choice.index + opening!.length, end - 1);
    const after = message.slice(end);
    const branches = new Map<string, string>();
    let rest = body!;
    while (rest.trim() !== '') {
      const head = /^\s*(=?\w+)\s*\{/.exec(rest)!;
      let depth = 1;
      let at = head[0].length;
      while (depth > 0) {
        if (rest[at] === '{') depth++;
        if (rest[at] === '}') depth--;
        at++;
      }
      branches.set(head[1]!, rest.slice(head[0].length, at - 1));
      rest = rest.slice(at);
    }
    const value = values[name!];
    const key =
      kind === 'plural'
        ? branches.has(`=${String(value)}`)
          ? `=${String(value)}`
          : new Intl.PluralRules('en-GB').select(Number(value))
        : String(value);
    const branch = (branches.get(key) ?? branches.get('other')!).replaceAll('#', String(value));
    return english(before! + branch + after!, values);
  }
  return message.replace(/\{(\w+)(?:, number)?\}/g, (_, name: string) => String(values[name]));
}

const ENGLISH: EditorSaying = {
  words: (key, values) => english(EDITOR_WORDS[key], values),
  list: (values, type) => new Intl.ListFormat('en-GB', { type }).format(values),
};

let saying: EditorSaying = ENGLISH;

/** The renderer's words from now on, or English again with null. */
export function sayWith(next: EditorSaying | null): void {
  saying = next ?? ENGLISH;
}

/** One of the editor's messages in the person's language, its placeholders filled. */
export const say = (key: EditorWordKey, values?: EditorWordValues): string =>
  saying.words(key, values);

/** A list joined as the person's language joins one. */
export const listOf = (
  values: readonly string[],
  type: 'conjunction' | 'disjunction' | 'unit',
): string => saying.list(values, type);
