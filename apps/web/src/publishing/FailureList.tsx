import { failureWords, type Failure } from './failures.js';

/**
 * Why a publish or a preview could not be made, one failure an item, each named by its place in the
 * outline where it has one (`placeOf`) and said in `failureWords`' words: a preview's failures are a
 * publish's, and read the same (publishing.md, "Shown beside the text").
 */
export function FailureList({
  label,
  failures,
  placeOf,
}: {
  readonly label: string;
  readonly failures: readonly Failure[];
  readonly placeOf: (node: string) => string;
}) {
  return (
    <ul aria-label={label}>
      {failures.map((failure, index) => (
        <li key={`${failure.code}-${failure.node ?? ''}-${failure.block ?? ''}-${index}`}>
          {failure.node === null ? '' : `${placeOf(failure.node)}: `}
          {failureWords(failure)}
        </li>
      ))}
    </ul>
  );
}
