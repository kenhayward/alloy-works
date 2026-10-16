/** How many words a probe holds: fewer would match ordinary prose by chance (the R6 plan, R6-G). */
export const PROBE_WORDS = 4;

/** Text as words, folded: case, compatibility forms and spacing never hide a match. */
const wordsOf = (text: string): string[] =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];

const windowsOf = (words: readonly string[]): string[] => {
  const found: string[] = [];
  for (let at = 0; at + PROBE_WORDS <= words.length; at += 1) {
    found.push(words.slice(at, at + PROBE_WORDS).join(' '));
  }
  return found;
};

/**
 * What the scan looks for (REU-048; R6-G): every run of four words in an excluded passage that the
 * kept text does not also hold, once each, in order. A passage shorter than that is not probed.
 */
export function probesOf(excluded: readonly string[], kept: string): string[] {
  const held = ` ${wordsOf(kept).join(' ')} `;
  const probes = new Set<string>();
  for (const passage of excluded) {
    for (const probe of windowsOf(wordsOf(passage))) {
      if (!held.includes(` ${probe} `)) probes.add(probe);
    }
  }
  return [...probes];
}

/** The probes an output's text holds (REU-048): each a passage that was excluded and is there. */
export function leaked(probes: readonly string[], text: string): string[] {
  const held = ` ${wordsOf(text).join(' ')} `;
  return probes.filter((probe) => held.includes(` ${probe} `));
}
