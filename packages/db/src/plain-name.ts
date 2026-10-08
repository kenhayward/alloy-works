/** Any control character: C0, DEL and C1. */
const CONTROL = /\p{Cc}/u;

/**
 * Whether a name is one a person may give a dataset or a space: 1 to 200 characters, trimmed, no
 * control character, in NFC. The caller normalises and trims before asking; a name stored is never
 * judged again unless it is the one being changed.
 */
export function isPlainName(name: string): boolean {
  const length = [...name].length;
  return (
    length >= 1 &&
    length <= 200 &&
    name === name.trim() &&
    !CONTROL.test(name) &&
    name === name.normalize('NFC')
  );
}
