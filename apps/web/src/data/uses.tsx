/** What uses something: those the caller may read, by title, and how many more there are (D3-M). */
export interface Uses {
  readonly readable: readonly { readonly id: string; readonly title: string }[];
  readonly others: number;
}

export function isUses(value: unknown): value is Uses {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { others?: unknown }).others === 'number' &&
    Array.isArray((value as { readable?: unknown }).readable) &&
    (value as { readable: unknown[] }).readable.every(
      (each) =>
        typeof each === 'object' &&
        each !== null &&
        typeof (each as { id?: unknown }).id === 'string' &&
        typeof (each as { title?: unknown }).title === 'string',
    )
  );
}

/**
 * One kind of use, the readable ones linked and the rest counted, never named (DAT-016, DAT-064):
 * `counted` says how the rest use it - a component binds a definition, a document holds a result of a
 * definition or from a connection.
 */
export function UsedList({
  heading,
  uses,
  link,
  counted,
}: {
  readonly heading: string;
  readonly uses: Uses;
  readonly link: (id: string) => string;
  readonly counted: (others: number) => string;
}) {
  if (uses.readable.length === 0 && uses.others === 0) return null;
  return (
    <>
      <h3>{heading}</h3>
      {uses.readable.length > 0 && (
        <ul>
          {uses.readable.map((each) => (
            <li key={each.id}>
              <a href={link(each.id)}>{each.title}</a>
            </li>
          ))}
        </ul>
      )}
      {uses.others > 0 && (
        <p>
          {uses.readable.length > 0
            ? `And ${uses.others} more you may not read.`
            : counted(uses.others)}
        </p>
      )}
    </>
  );
}
