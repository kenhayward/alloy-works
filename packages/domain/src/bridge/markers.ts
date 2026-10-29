/** What a superscript run's parts are split on: whitespace, commas, semicolons, parentheses and brackets. */
const SEPARATORS = /[\s,;()[\]]+/;

const partsOf = (text: string): string[] => text.split(SEPARATORS).filter((part) => part !== '');

/**
 * The table notes a superscript run names, or `undefined` when it names none: split on whitespace,
 * commas, semicolons, parentheses and brackets, every part must be a marker of the table's notes
 * (`1)`, `1)2)`, `1,2`, `a`), and a run with any other part stays text. A part matches a marker as the
 * note is written (`1)`) or as the run is split (`1`, which a note written `1)` answers to); what comes
 * back is the notes' markers as written, in the run's order.
 */
export function noteMarkers(
  run: string,
  known: ReadonlySet<string>,
): readonly string[] | undefined {
  const parts = partsOf(run);
  if (parts.length === 0) return undefined;
  const bare = new Map<string, string>();
  for (const marker of known) {
    const only = partsOf(marker);
    if (only.length === 1 && !bare.has(only[0]!)) bare.set(only[0]!, marker);
  }
  const found: string[] = [];
  for (const part of parts) {
    const marker = known.has(part) ? part : bare.get(part);
    if (marker === undefined) return undefined;
    found.push(marker);
  }
  return found;
}
