import { describe, expect, it } from 'vitest';

import {
  checkStyle,
  plainText,
  renderCitations,
  runsOf,
  SAMPLE_CITATIONS,
  SAMPLE_ENTRIES,
  variablesUsed,
} from './citations.js';
import { SEEDED_STYLE_FILES } from './csl/files.js';
import type { CslItem } from './entry.js';

const harvard = SEEDED_STYLE_FILES['harvard-cite-them-right'];
const vancouver = SEEDED_STYLE_FILES['nlm-citation-sequence'];
const cse = SEEDED_STYLE_FILES['cse-name-year'];

const rendered = (style: string, language = 'en-GB') => {
  const out = renderCitations({
    style,
    language,
    entries: SAMPLE_ENTRIES,
    citations: SAMPLE_CITATIONS,
  });
  return {
    citations: out.citations.map(plainText),
    bibliography: out.bibliography.map((each) => ({
      entry: each.entry,
      ...(each.label === undefined ? {} : { label: plainText(each.label) }),
      text: plainText(each.runs),
    })),
  };
};

describe('the citations module', () => {
  it('STY-020 a style renders both its in-text form and its bibliography form', () => {
    for (const style of [harvard, vancouver, cse]) {
      const out = rendered(style);
      expect(out.citations).toHaveLength(SAMPLE_CITATIONS.length);
      expect(out.citations.every((each) => each.length > 0)).toBe(true);
      expect(out.bibliography.map((each) => each.entry).sort()).toEqual(
        Object.keys(SAMPLE_ENTRIES).sort(),
      );
    }
  });

  it('STY-021 CNT-102 Harvard renders the invented entries as Cite Them Right sets them', () => {
    expect(rendered(harvard)).toEqual({
      citations: [
        '(Penhallow and Ferreira, 2018, p. 112)',
        '(Marlow, 2020b)',
        '(Marlow, 2020a)',
        '(Coastal Records Office, 2023)',
        '(Marlow, 2020b)',
      ],
      bibliography: [
        {
          entry: 'records-bulletin',
          text: 'Coastal Records Office (2023) Annual flood bulletin. Available at: https://example.org/flood-bulletin (Accessed: 1 March 2024).',
        },
        {
          entry: 'marlow-sediment',
          text: 'Marlow, A. (2020a) Sediment and its movement. Bristol: Harbour Press.',
        },
        {
          entry: 'marlow-tides',
          text: 'Marlow, A. (2020b) ‘Tidal patterns of the northern estuary’, Journal of Coastal Studies, 12(3), pp. 45–67. Available at: https://doi.org/10.5555/jcs.2020.012.',
        },
        {
          entry: 'penhallow-marshes',
          text: 'Penhallow, G. and Ferreira, T. (2018) ‘Salt marshes’, in I. Duval (ed.) Wetlands of Europe. Ely: Fenland Books, pp. 101–130.',
        },
      ],
    });
  });

  it('STY-021 CNT-102 Vancouver renders the invented entries as the NLM sets them', () => {
    expect(rendered(vancouver)).toEqual({
      citations: ['(1)', '(2)', '(3)', '(4)', '(2)'],
      bibliography: [
        {
          entry: 'penhallow-marshes',
          label: '1.',
          text: 'Penhallow G, Ferreira T. Salt marshes. In: Duval I, editor. Wetlands of Europe. Ely: Fenland Books; 2018. p. 101–30.',
        },
        {
          entry: 'marlow-tides',
          label: '2.',
          text: 'Marlow A. Tidal patterns of the northern estuary. Journal of Coastal Studies. 2020 Mar;12(3):45–67. doi:10.5555/jcs.2020.012',
        },
        {
          entry: 'marlow-sediment',
          label: '3.',
          text: 'Marlow A. Sediment and its movement. Bristol: Harbour Press; 2020.',
        },
        {
          entry: 'records-bulletin',
          label: '4.',
          text: 'Coastal Records Office. Annual flood bulletin [Internet]. 2023 [cited 2024 Mar 1]. Available from: https://example.org/flood-bulletin',
        },
      ],
    });
  });

  it('STY-021 CNT-102 CSE renders the invented entries name-year', () => {
    expect(rendered(cse)).toEqual({
      citations: [
        '(Penhallow and Ferreira 2018: 112)',
        '(Marlow 2020b)',
        '(Marlow 2020a)',
        '(Coastal Records Office 2023 Nov 2)',
        '(Marlow 2020b)',
      ],
      bibliography: [
        {
          entry: 'records-bulletin',
          text: 'Coastal Records Office. 2023. [accessed 2024 Mar 1]. https://example.org/flood-bulletin',
        },
        {
          entry: 'marlow-sediment',
          text: 'Marlow A. 2020a. Sediment and its movement. Harbour Press.',
        },
        {
          entry: 'marlow-tides',
          text: 'Marlow A. 2020b. Tidal patterns of the northern estuary. Journal of Coastal Studies. 12(3):45–67. https://doi.org/10.5555/jcs.2020.012',
        },
        {
          entry: 'penhallow-marshes',
          text: 'Penhallow G, Ferreira T. 2018. Salt marshes. In: Duval I, editor. Wetlands of Europe. Fenland Books; p 101–130',
        },
      ],
    });
  });

  it('STY-022 two sources that would render alike are told apart, in the order the style sets', () => {
    // Ada Marlow's two works of 2020 are told apart by a letter, given in the bibliography's order -
    // by title - not the order they are cited in.
    const byName = rendered(harvard);
    expect(byName.citations.slice(1, 3)).toEqual(['(Marlow, 2020b)', '(Marlow, 2020a)']);
    expect(byName.bibliography.map((each) => each.entry)).toEqual([
      'records-bulletin',
      'marlow-sediment',
      'marlow-tides',
      'penhallow-marshes',
    ]);
    // Vancouver numbers each in the order it is first cited, a source cited again by its first
    // number, and needs no letter.
    const bySequence = rendered(vancouver);
    expect(bySequence.citations).toEqual(['(1)', '(2)', '(3)', '(4)', '(2)']);
    expect(bySequence.bibliography.map((each) => each.entry)).toEqual([
      'penhallow-marshes',
      'marlow-tides',
      'marlow-sediment',
      'records-bulletin',
    ]);
  });

  it("carries the style's and the entry's italic, bold, subscript and superscript as marks", () => {
    // Harvard sets a book's title in italic; the title's own italic is set upright inside it.
    const out = renderCitations({
      style: harvard,
      language: 'en-GB',
      entries: {
        salinity: {
          type: 'book',
          title: 'Salinity, H<sub>2</sub>O and <b>light</b> in <i>Zostera</i> beds<sup>1</sup>',
          author: [{ family: 'Marlow', given: 'Ada' }],
          issued: { 'date-parts': [[2021]] },
          publisher: 'Harbour & Sons',
        },
      },
      citations: [{ entry: 'salinity' }],
    });
    const italic = { kind: 'emphasis' } as const;
    expect(out.bibliography[0]!.runs).toEqual([
      { text: 'Marlow, A. (2021) ', marks: [] },
      { text: 'Salinity, H', marks: [italic] },
      { text: '2', marks: [italic, { kind: 'subscript' }] },
      { text: 'O and ', marks: [italic] },
      { text: 'light', marks: [italic, { kind: 'strong' }] },
      { text: ' in ', marks: [italic] },
      { text: 'Zostera', marks: [] },
      { text: ' beds', marks: [italic] },
      { text: '1', marks: [italic, { kind: 'superscript' }] },
      { text: '. Harbour & Sons.', marks: [] },
    ]);
  });

  it('decodes only character references to a code point, keeping any other as written', () => {
    expect(runsOf('A&#66;&#x43;&#x1F600;').runs).toEqual([
      { text: `ABC${String.fromCodePoint(0x1f600)}`, marks: [] },
    ]);
    for (const literal of ['&#x110000;', '&#xD800;', '&#99999999999;', '&#xDFFF;']) {
      expect(runsOf(`a${literal}`).runs).toEqual([{ text: `a${literal}`, marks: [] }]);
    }
  });

  it('links only to an http or https address, never a script an entry names', () => {
    expect(runsOf('<a href="javascript:alert(1)">here</a>').runs).toEqual([
      { text: 'here', marks: [] },
    ]);
    expect(runsOf('<a href="data:text/html,x">here</a>').runs).toEqual([
      { text: 'here', marks: [] },
    ]);
    expect(runsOf('<a href="https://example.org/a">here</a>').runs).toEqual([
      { text: 'here', marks: [{ kind: 'hyperlink', href: 'https://example.org/a' }] },
    ]);
    // An entry's URL and DOI reach no link that is not the web's, in any seeded style.
    for (const style of [harvard, vancouver, cse]) {
      const out = renderCitations({
        style,
        entries: {
          bad: {
            type: 'webpage',
            title: 'Annual flood bulletin',
            URL: 'javascript:alert(1)',
            DOI: 'javascript:alert(2)',
          },
        },
        citations: [{ entry: 'bad' }],
      });
      const marks = [...out.citations.flat(), ...out.bibliography.flatMap((each) => each.runs)]
        .flatMap((run) => run.marks)
        .filter((mark) => mark.kind === 'hyperlink');
      expect(marks).toEqual([]);
    }
  });

  it("speaks the document's language, falling back to en-US where no locale is held", () => {
    const de = rendered(harvard, 'de-DE');
    expect(de.citations[0]).toBe('(Penhallow und Ferreira, 2018, S. 112)');
    expect(rendered(harvard, 'xx-XX')).toEqual(rendered(harvard, 'en-US'));
  });

  it('refuses a citation of an entry it was not given', () => {
    expect(() =>
      renderCitations({
        style: harvard,
        entries: SAMPLE_ENTRIES,
        citations: [{ entry: 'nobody' }],
      }),
    ).toThrow('nobody');
  });

  it('renders 200 citations and their bibliography, timed', () => {
    const entries: Record<string, CslItem> = {};
    for (let n = 0; n < 100; n += 1) {
      entries[`e${n}`] = {
        type: 'article-journal',
        title: `Observations of the estuary, part ${n}`,
        author: [{ family: `Marlow${String.fromCharCode(65 + (n % 26))}`, given: 'Ada' }],
        issued: { 'date-parts': [[2000 + (n % 20)]] },
        'container-title': 'Journal of Coastal Studies',
        volume: String(n),
        page: `${n}-${n + 9}`,
      };
    }
    const citations = Array.from({ length: 200 }, (_, n) => ({ entry: `e${(n * 7) % 100}` }));
    for (const [name, style] of Object.entries({ harvard, vancouver, cse })) {
      const started = performance.now();
      const out = renderCitations({ style, entries, citations });
      const took = performance.now() - started;
      expect(out.citations).toHaveLength(200);
      expect(out.bibliography).toHaveLength(100);
      // Measured, not held to a budget (the CI plan's risks): 50 to 110 ms on a laptop on
      // 2026-10-22, Harvard the slowest. The bound only catches a pathology.
      expect(took, name).toBeLessThan(5000);
    }
  });
});

describe('a style checked as CSL 1.0.2', () => {
  it('passes each seeded style', () => {
    expect(checkStyle(harvard)).toEqual([]);
    expect(checkStyle(vancouver)).toEqual([]);
    expect(checkStyle(cse)).toEqual([]);
  });

  it('STY-020 refuses what is not XML, not a CSL style, or lacks either form', () => {
    const messages = (xml: string) => checkStyle(xml).map((each) => each.message);
    expect(messages('not a style')).toEqual([
      'The file is not XML: Text stands outside the root element',
    ]);
    expect(messages('<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">')).toEqual([
      'The file is not XML: <style> is never closed',
    ]);
    expect(messages('<locale xmlns="http://purl.org/net/xbiblio/csl" version="1.0"/>')).toEqual([
      'The file is not a CSL style: its root is not a style in the CSL namespace',
    ]);
    expect(messages(harvard.replace(/(<style[^>]*)version="1.0"/, '$1version="0.8"'))).toEqual([
      'The style is CSL 0.8, not 1.0',
    ]);
    expect(messages(harvard.replace(/<bibliography[\s\S]*<\/bibliography>/, ''))).toEqual([
      'The style declares no bibliography form',
    ]);
    expect(messages(harvard.replace(/<citation[\s\S]*<\/citation>/, ''))).toEqual([
      'The style declares no citation form',
    ]);
    expect(messages(`<!DOCTYPE x [<!ENTITY a "b">]>${harvard}`)).toEqual([
      'The file is not XML: A style declares no document type or entity',
    ]);
  });

  it('refuses a dependent style, naming the parent to upload instead', () => {
    const dependent = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Coastal Studies</title>
    <id>http://www.zotero.org/styles/coastal-studies</id>
    <link href="http://www.zotero.org/styles/harvard-cite-them-right" rel="independent-parent"/>
    <updated>2026-01-01T00:00:00+00:00</updated>
  </info>
</style>`;
    expect(checkStyle(dependent).map((each) => each.message)).toEqual([
      'The style is a dependent style: upload its parent, http://www.zotero.org/styles/harvard-cite-them-right',
    ]);
  });
});

/** A style whose macros each call the one before twice: `depth` macros expand to 2^depth texts. */
export function doublingStyle(depth: number, recursive = false): string {
  const macros = Array.from({ length: depth }, (_, n) =>
    n === 0
      ? `<macro name="m0"><text ${recursive ? `macro="m${depth - 1}"` : 'variable="title"'}/></macro>`
      : `<macro name="m${n}"><group><text macro="m${n - 1}"/><text macro="m${n - 1}"/></group></macro>`,
  ).join('');
  return `<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
<info><title>Doubling</title><id>doubling</id><updated>2026-01-01T00:00:00+00:00</updated></info>
${macros}
<citation><layout><text macro="m${depth - 1}"/></layout></citation>
<bibliography><layout><text macro="m${depth - 1}"/></layout></bibliography>
</style>`;
}

describe('a style too large to expand', () => {
  it('passes a style whose macros expand to a modest size', () => {
    expect(checkStyle(doublingStyle(8))).toEqual([]);
  });

  it('refuses a style whose macros expand exponentially, before citeproc reads it', () => {
    const style = doublingStyle(40);
    const started = performance.now();
    expect(checkStyle(style).map((each) => each.message)).toEqual([
      'The style expands to more than 50000 elements once its macros are followed',
    ]);
    expect(() =>
      renderCitations({ style, entries: SAMPLE_ENTRIES, citations: SAMPLE_CITATIONS }),
    ).toThrow('more than 50000 elements');
    // Measured at a few milliseconds; the bound only catches citeproc having read it.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('refuses a macro that calls itself, however indirectly', () => {
    expect(checkStyle(doublingStyle(3, true)).map((each) => each.message)).toEqual([
      "The style's macro m2 calls itself",
    ]);
  });
});

describe('the variables a style prints', () => {
  it('proposes, for each type, the variables a reader needs that its layouts always print', () => {
    const proposed = variablesUsed(harvard);
    expect(proposed['article-journal']).toEqual(['page', 'title', 'volume']);
    expect(proposed.book).toEqual(['page', 'publisher', 'title']);
    // Vancouver tests what an entry holds before it prints a title, so does not propose one.
    expect(variablesUsed(vancouver)['article-journal']).toEqual(['issued', 'volume']);
    expect(variablesUsed(cse).webpage).toEqual(['URL', 'container-title', 'issued']);
  });
});
