/** An entry's CSL as the pages read it: only what they show, each member checked before it is. */

interface Name {
  readonly family?: string;
  readonly given?: string;
  readonly literal?: string;
}

export interface Csl {
  readonly type: string;
  readonly title?: string;
  readonly author?: readonly Name[];
  readonly issued?: {
    readonly 'date-parts'?: readonly (readonly (number | string)[])[];
    readonly raw?: string;
    readonly literal?: string;
  };
  readonly DOI?: string;
  readonly [variable: string]: unknown;
}

/** The authors' family names, as a list shows them. */
export const authorsShort = (csl: Csl) =>
  (csl.author ?? []).map((each) => each.family ?? each.literal ?? '').join(', ');

/** Each author whole, as the entry's page shows them. */
export const authorsFull = (csl: Csl) =>
  (csl.author ?? [])
    .map(
      (each) =>
        each.literal ??
        (each.given === undefined ? (each.family ?? '') : `${each.family ?? ''}, ${each.given}`),
    )
    .join('; ');

/** The issued year, from its parts, else the first four digits its literal or raw form holds. */
export function yearOf(csl: Csl): string {
  const first = csl.issued?.['date-parts']?.[0]?.[0];
  if (first !== undefined) return String(first);
  return /\d{4}/.exec(csl.issued?.literal ?? csl.issued?.raw ?? '')?.[0] ?? '';
}

/** What found a match, as a person reads it. */
export const FOUND_BY: Readonly<Record<string, string>> = {
  doi: 'its DOI',
  pmid: 'its PubMed identifier',
  isbn: 'its ISBN',
  issn: 'its ISSN',
  work: 'its title, year and first author',
};

/** The source types the hand-made form offers, by CSL's names. */
export const TYPES: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'article-journal', label: 'Journal article' },
  { value: 'book', label: 'Book' },
  { value: 'chapter', label: 'Book chapter' },
  { value: 'paper-conference', label: 'Conference paper' },
  { value: 'report', label: 'Report' },
  { value: 'thesis', label: 'Thesis' },
  { value: 'webpage', label: 'Web page' },
  { value: 'standard', label: 'Standard' },
  { value: 'document', label: 'Other document' },
];

/** Authors typed one a line, family name first: `Smith, Ada`, or a body's name whole. */
export function authorsTyped(text: string): Csl['author'] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const comma = line.indexOf(',');
      if (comma < 0) return { family: line };
      const given = line.slice(comma + 1).trim();
      return { family: line.slice(0, comma).trim(), ...(given === '' ? {} : { given }) };
    });
}

/** The authors as the edit form shows them: one a line, family name first, as they are typed. */
export const authorsLines = (csl: Csl) =>
  (csl.author ?? [])
    .map(
      (each) =>
        each.literal ??
        (each.given === undefined ? (each.family ?? '') : `${each.family ?? ''}, ${each.given}`),
    )
    .join('\n');
