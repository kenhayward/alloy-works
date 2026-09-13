/**
 * Whether `pnpm trace pack` may run, given `git status --porcelain`'s raw output. Pure - `cli.ts`
 * supplies the actual porcelain text and owns the one call to `git` - so this is testable without a
 * repository at all.
 *
 * The reason is structural, not a style preference: `pack` stamps the evidence pack with
 * `git rev-parse HEAD`, and a pack generated while the working tree holds uncommitted changes is
 * generated one commit later than the commit it claims - `git rev-parse HEAD` names the *parent* of
 * whatever gets committed next. An auditor who checks out the stamped commit then finds a
 * `matrix.md` that does not match the one in the pack, which defeats the whole reason a commit is
 * recorded at all: reproducing the pack from the tag it claims.
 */
export function dirtyTreeRefusal(porcelainStatus: string): string | undefined {
  if (porcelainStatus.trim().length === 0) return undefined;
  return (
    'Refusing to pack: the working tree is not clean (`git status --porcelain` reports changes). ' +
    "Commit them first. A pack stamped with `git rev-parse HEAD` names the commit's parent, not " +
    "the commit that will hold the pack's own inputs once they land - so a pack built from a dirty " +
    'tree is stamped with a commit that cannot reproduce it.'
  );
}
