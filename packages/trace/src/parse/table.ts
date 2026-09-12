/**
 * One markdown table row to its trimmed cells, or `undefined` when the line is not a table row.
 *
 * Splits on pipes that are not escaped, because a requirement statement is allowed to contain a
 * literal `\|` and a naive split would cut it in half. The previous regular-expression approach in
 * `apps/desktop/src/requirements.test.ts` got this right by accident, through a lazy match anchored
 * at the end of the line; doing it on purpose is the point of having a parser.
 */
export function tableCells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) return undefined;
  return trimmed
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

/** The identifier a row is for, taken from its bolded first cell, or `undefined`. */
export function boldIdentifier(cell: string): string | undefined {
  return /^\*\*([A-Z]{3}-(?:\d{3}|N\d{2}|Q\d{2}))\*\*$/.exec(cell)?.[1];
}
