/**
 * The attributes whose values a reader is told, which the leak scan reads as it reads the text (the
 * HT plan, HT-L): an image's alternative, an accessible name, a tooltip, and an equation's alternative.
 */
const SAID = new Set(['alt', 'aria-label', 'title', 'alttext']);

/** The named characters the writer escapes by, and the space a browser reads `&nbsp;` as. */
const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Character references decoded: named, decimal and hexadecimal; one it does not know left as it is. */
function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

const ATTRIBUTE = /([\w:-]+)\s*=\s*"([^"]*)"/g;

/**
 * **An HTML output's text, as a reader meets it** (the HT plan, HT-L): every run of text between its
 * tags, its characters decoded and joined as they stand - a word a mark begins inside is one word, and
 * the writer parts its blocks by a line - and the value of every attribute a reader is told, each
 * apart; never
 * what a `<style>` holds, which is the theme's and no reader's. What the leak scan searches an HTML
 * output for each four words a condition took out (REU-048), as it searches a PDF's pages and a Word
 * document's parts.
 */
export function htmlText(bytes: Uint8Array): string {
  const html = new TextDecoder().decode(bytes);
  const pieces: string[] = [];
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open === -1) {
      pieces.push(decode(html.slice(index)));
      break;
    }
    if (open > index) pieces.push(decode(html.slice(index, open)));
    const close = html.indexOf('>', open);
    if (close === -1) break;
    const tag = html.slice(open + 1, close);
    for (const match of tag.matchAll(ATTRIBUTE)) {
      if (SAID.has(match[1]!.toLowerCase())) pieces.push(` ${decode(match[2]!)} `);
    }
    index = close + 1;
    // A style's rules are the theme's: skipped whole, to its end tag.
    if (/^style\b/i.test(tag)) {
      const end = html.toLowerCase().indexOf('</style>', index);
      index = end === -1 ? html.length : end;
    }
  }
  return pieces.join('');
}
