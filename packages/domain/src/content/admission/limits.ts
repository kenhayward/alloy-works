/**
 * How much one admission may hold, checked before any stage walks the content.
 *
 * Every stage after this one recurses, and a recursion over content somebody else wrote is a stack
 * somebody else sizes. So the measure is iterative, it runs first, and what it refuses no stage ever
 * sees. The numbers are provisional: content-model.md's CMD-Q03 asks when the pipeline needs
 * streaming and leaves it to the first real import, and these are sized for a component, not a book.
 */
export const admissionLimits = {
  /** Every string's length added together, and the longest clipboard text a reader will parse. */
  characters: 8_000_000,
  /** Nesting of arrays and objects. A list six levels deep (CNT-118) is about 26; this is far above it. */
  depth: 128,
  /** Every value: objects, arrays, strings, numbers, booleans and nulls. */
  values: 250_000,
  /** Element nesting inside one equation's MathML. */
  mathDepth: 64,
} as const;

/** The first limit the value exceeds, as a sentence for the developer, or undefined when within. */
export function exceedsLimits(value: unknown): string | undefined {
  let characters = 0;
  let values = 0;
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 1 }];

  while (stack.length > 0) {
    const next = stack.pop()!;
    values += 1;
    if (values > admissionLimits.values) {
      return `more than ${admissionLimits.values} values`;
    }
    if (typeof next.value === 'string') {
      characters += next.value.length;
      if (characters > admissionLimits.characters) {
        return `more than ${admissionLimits.characters} characters`;
      }
      continue;
    }
    if (typeof next.value !== 'object' || next.value === null) continue;
    if (next.depth > admissionLimits.depth) {
      return `nested more than ${admissionLimits.depth} deep`;
    }
    const members = Array.isArray(next.value) ? next.value : Object.values(next.value);
    for (const member of members) stack.push({ value: member, depth: next.depth + 1 });
  }
  return undefined;
}
