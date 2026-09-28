import { failureWords, type Failure } from './failures.js';

/**
 * Why a publish or a preview could not be made, one failure an item, each named by its place in the
 * outline where it has one (`placeOf`) and said in `failureWords`' words: a preview's failures are a
 * publish's, and read the same (publishing.md, "Shown beside the text") - save that only a publish
 * under a layout with a Word page is offered Word in their place (`wordOffered`).
 */
export function FailureList({
  label,
  failures,
  placeOf,
  wordOffered = false,
}: {
  readonly label: string;
  readonly failures: readonly Failure[];
  readonly placeOf: (node: string) => string;
  readonly wordOffered?: boolean;
}) {
  return (
    <ul aria-label={label}>
      {failures.map((failure, index) => (
        <li key={`${failure.code}-${failure.node ?? ''}-${failure.block ?? ''}-${index}`}>
          {failure.node === null ? '' : `${placeOf(failure.node)}: `}
          {failureWords(failure, wordOffered)}
        </li>
      ))}
    </ul>
  );
}
