/**
 * The canonical serialisation every stored payload in this package takes, and the input to any hash
 * or digest over it (ADR-0024).
 *
 * Three rules, and no more: members in lexicographic order, strings in NFC, no insignificant
 * whitespace. **Arrays keep their order** unless the caller names a member whose array is a set - the
 * content model's `marks`, which CNT-003 makes a set. The rule is the caller's rather than this
 * module's because a member name means nothing here: a metadata field whose identifier happens to be
 * `marks` holds a list whose order is part of its value (MET-030), and a rule keyed on the name alone
 * would sort it.
 */
export type ArrayOrder = (member: string, array: readonly unknown[]) => readonly unknown[];

export function canonicalJson(value: unknown, order?: ArrayOrder): string {
  return emit(value, order);
}

function emit(value: unknown, order: ArrayOrder | undefined): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map((member) => emit(member, order)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, member]) => {
        const ordered = order && Array.isArray(member) ? order(key, member) : member;
        return `${JSON.stringify(key)}:${emit(ordered, order)}`;
      })
      .join(',')}}`;
  }
  throw new Error(`Cannot canonicalise a value of type ${typeof value}`);
}
