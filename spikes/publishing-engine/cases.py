"""The gate cases from Publishing_Engine_Spike.md, each emitted twice: as XHTML for the three
HTML engines, and as Typst markup for Typst.

Emitting both from one description is deliberate. ADR-0005 makes XHTML the publishing
intermediate, and section 6 of the brief asks what choosing Typst would cost. The honest answer is
"a second emitter", and writing one here is the cheapest way to see how big that is.

Every word of text is generated from a fixed vocabulary with a seeded generator. No real content.
Unique tokens (mark07, note07, row12, ...) are planted so the checks can find things by extracting
text, independent of how each engine lays them out.
"""

from __future__ import annotations

import random
import struct
import zlib
from dataclasses import dataclass, field
from pathlib import Path

# Deliberately excludes every table header label and token so a search for one finds only it.
VOCAB = """
account action advice agreement amount analysis approach area argument aspect assessment
balance basis benefit budget capacity care case centre change choice claim clause committee
concern condition context contract control cost council course cover credit data decision
degree demand design detail development difference direction distance division effect effort
element energy estimate evidence example exchange experience extent factor feature figure focus
form framework function growth guidance impact income increase industry influence input interest
issue item knowledge labour language level limit line list loss management market material
matter meaning method model moment movement network number objective option order output
pattern payment period phase picture place plan point policy position practice pressure price
principle priority problem procedure process product programme project property proportion
purpose quality quantity range rate reason record region relation report request requirement
resource response result return review risk role rule sample scale scheme section sector sense
series service share side signal size source space stage standard statement step strategy
structure study subject supply support surface system target task term test theory threshold
time total trade trend unit use value version view volume weight whole work
""".split()

LINKS = ['and', 'with', 'for', 'across', 'within', 'under', 'against', 'beyond', 'through', 'over']
VERBS = ['shows', 'reflects', 'supports', 'limits', 'shapes', 'follows', 'affects', 'confirms',
         'extends', 'reduces', 'defines', 'records', 'meets', 'exceeds', 'tracks', 'informs']


class Text:
    """Seeded, deterministic, plausible-shaped prose. Same seed, same words, every run."""

    def __init__(self, seed: int) -> None:
        self.rng = random.Random(seed)

    def sentence(self, low: int = 12, high: int = 22) -> str:
        n = self.rng.randint(low, high)
        words = []
        for i in range(n):
            if i and i % 5 == 2:
                words.append(self.rng.choice(VERBS))
            elif i and i % 5 == 4:
                words.append(self.rng.choice(LINKS))
            else:
                words.append(self.rng.choice(VOCAB))
        words[0] = words[0].capitalize()
        return ' '.join(words) + '.'

    def words(self, n: int) -> str:
        return ' '.join(self.rng.choice(VOCAB) for _ in range(n))

    def paragraph(self, sentences: int) -> str:
        return ' '.join(self.sentence() for _ in range(sentences))


# ---------------------------------------------------------------------------------------------
# A tiny document model, so each case is described once and emitted twice.
# ---------------------------------------------------------------------------------------------

@dataclass
class Footnote:
    text: str


@dataclass
class Para:
    parts: list  # str | Footnote | Lang
    style: str = ''


@dataclass
class Lang:
    lang: str
    text: str


@dataclass
class Heading:
    level: int
    text: str


@dataclass
class Bullets:
    items: list[str]


@dataclass
class Table:
    caption: str
    header: list[str]
    rows: list[list]  # each cell: str or list of (str | Footnote)


@dataclass
class Figure:
    src: str
    alt: str
    caption: str


@dataclass
class Doc:
    title: str
    blocks: list = field(default_factory=list)
    lang: str = 'en'


# ---------------------------------------------------------------------------------------------
# Emitter 1: XHTML + CSS Paged Media. WeasyPrint, PagedJS and headless Chrome all read this.
# ---------------------------------------------------------------------------------------------

CSS = """
@page { size: A4; margin: 25mm 22mm 28mm 22mm;
        @bottom-center { content: counter(page); font: 9pt "Liberation Serif"; } }
html { font-family: "Liberation Serif"; font-size: 11pt; line-height: 1.35; }
body { margin: 0; }
h1 { font-size: 18pt; margin: 0 0 10pt; break-after: avoid; }
h2 { font-size: 14pt; margin: 12pt 0 6pt; break-after: avoid; }
p { margin: 0 0 6pt; orphans: 2; widows: 2; }
ul { margin: 0 0 6pt; }
.fn { float: footnote; font-size: 9pt; line-height: 1.25; }
::footnote-call { content: counter(footnote); vertical-align: super; font-size: 7pt; }
::footnote-marker { content: counter(footnote) ". "; }
table { border-collapse: collapse; width: 100%; margin: 0 0 8pt; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { border: 0.5pt solid #444; padding: 2pt 4pt; vertical-align: top; font-size: 9.5pt;
         text-align: left; }
caption { caption-side: top; text-align: left; font-weight: bold; padding-bottom: 3pt; }
figure { margin: 8pt 0; break-inside: avoid; }
figure img { width: 60mm; }
figcaption { font-size: 9.5pt; font-style: italic; }
"""


def _esc(s: str) -> str:
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def _html_inline(parts) -> str:
    out = []
    for part in parts:
        if isinstance(part, Footnote):
            out.append(f'<span class="fn">{_esc(part.text)}</span>')
        elif isinstance(part, Lang):
            out.append(f'<span lang="{part.lang}" xml:lang="{part.lang}">{_esc(part.text)}</span>')
        else:
            out.append(_esc(part))
    return ''.join(out)


def to_html(doc: Doc) -> str:
    body = []
    for b in doc.blocks:
        if isinstance(b, Heading):
            body.append(f'<h{b.level}>{_esc(b.text)}</h{b.level}>')
        elif isinstance(b, Para):
            body.append(f'<p>{_html_inline(b.parts)}</p>')
        elif isinstance(b, Bullets):
            body.append('<ul>' + ''.join(f'<li>{_esc(i)}</li>' for i in b.items) + '</ul>')
        elif isinstance(b, Table):
            head = ''.join(f'<th scope="col">{_esc(h)}</th>' for h in b.header)
            rows = []
            for row in b.rows:
                cells = []
                for cell in row:
                    cells.append('<td>' + (_html_inline(cell) if isinstance(cell, list)
                                           else _esc(cell)) + '</td>')
                rows.append('<tr>' + ''.join(cells) + '</tr>')
            body.append(f'<table><caption>{_esc(b.caption)}</caption>'
                        f'<thead><tr>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table>')
        elif isinstance(b, Figure):
            body.append(f'<figure><img src="{b.src}" alt="{_esc(b.alt)}"/>'
                        f'<figcaption>{_esc(b.caption)}</figcaption></figure>')
    return (
        '<!DOCTYPE html>\n'
        f'<html xmlns="http://www.w3.org/1999/xhtml" lang="{doc.lang}" xml:lang="{doc.lang}">\n'
        f'<head><meta charset="utf-8"/><title>{_esc(doc.title)}</title>'
        f'<style>{CSS}</style></head>\n'
        f'<body>\n' + '\n'.join(body) + '\n</body></html>\n'
    )


# ---------------------------------------------------------------------------------------------
# Emitter 2: Typst markup. The cost section 6 asks about, written out.
# ---------------------------------------------------------------------------------------------

TYPST_PREAMBLE = """
#set page(paper: "a4", margin: (top: 25mm, bottom: 28mm, x: 22mm), numbering: "1")
#set text(font: "Liberation Serif", size: 11pt, hyphenate: false)
#set par(leading: 0.62em, spacing: 6pt)
#show heading.where(level: 1): set text(size: 18pt)
#show heading.where(level: 2): set text(size: 14pt)
#show figure.where(kind: table): set figure.caption(position: top)
// Tables may run across pages; an image must never be parted from its caption.
#show figure.where(kind: table): set block(breakable: true)
#show table.cell: set text(size: 9.5pt)
#show footnote.entry: set text(size: 9pt)
"""


def _typ_text(s: str) -> str:
    # Generated text is words and ordinary punctuation. Escape the markup characters anyway, so a
    # later case that does not share that property fails loudly rather than rendering strangely.
    for ch in '\\#*_`$@<>[]~':
        s = s.replace(ch, '\\' + ch)
    return s


def _typ_inline(parts) -> str:
    out = []
    for part in parts:
        if isinstance(part, Footnote):
            out.append(f'#footnote[{_typ_text(part.text)}]')
        elif isinstance(part, Lang):
            out.append(f'#text(lang: "{part.lang}")[{_typ_text(part.text)}]')
        else:
            out.append(_typ_text(part))
    return ''.join(out)


def to_typst(doc: Doc) -> str:
    out = [f'#set document(title: [{_typ_text(doc.title)}])',
           f'#set text(lang: "{doc.lang}")', TYPST_PREAMBLE]
    for b in doc.blocks:
        if isinstance(b, Heading):
            out.append('=' * b.level + ' ' + _typ_text(b.text))
        elif isinstance(b, Para):
            out.append(_typ_inline(b.parts) + '\n')
        elif isinstance(b, Bullets):
            out.append('\n'.join('- ' + _typ_text(i) for i in b.items) + '\n')
        elif isinstance(b, Table):
            cols = len(b.header)
            header = ', '.join(f'[*{_typ_text(h)}*]' for h in b.header)
            cells = []
            for row in b.rows:
                for cell in row:
                    body = _typ_inline(cell) if isinstance(cell, list) else _typ_text(cell)
                    cells.append(f'[{body}]')
            out.append(
                f'#figure(caption: [{_typ_text(b.caption)}], table(columns: {cols}, '
                f'align: left, table.header({header}), {", ".join(cells)}))\n')
        elif isinstance(b, Figure):
            out.append(f'#figure(image("{b.src}", width: 60mm, alt: "{b.alt}"), '
                       f'caption: [{_typ_text(b.caption)}])\n')
    return '\n'.join(out) + '\n'


# ---------------------------------------------------------------------------------------------
# An image, written by hand so the case set carries no binary it did not generate.
# ---------------------------------------------------------------------------------------------

def write_chart_png(path: Path, w: int = 240, h: int = 140) -> None:
    bars = [0.35, 0.8, 0.55, 0.95, 0.6]
    rows = []
    for y in range(h):
        row = bytearray([0])  # filter type: none
        for x in range(w):
            i = x * len(bars) // w
            inset = (x % (w // len(bars))) > 6
            on = inset and (h - y) < bars[i] * (h - 10)
            row += bytes((40, 70, 120) if on else (245, 245, 240))
        rows.append(bytes(row))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack('>I', len(data)) + kind + data
                + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
           + chunk(b'IEND', b''))
    path.write_bytes(png)


# ---------------------------------------------------------------------------------------------
# The cases.
# ---------------------------------------------------------------------------------------------

def case1_tagged() -> Doc:
    """Headings, a list, a table with header cells, a figure with alt text, a second language."""
    t = Text(1)
    return Doc('Method statement for the quarterly review', [
        Heading(1, 'Method statement for the quarterly review'),
        Para([t.paragraph(3)]),
        Heading(2, 'Scope'),
        Bullets([t.sentence(6, 10) for _ in range(3)]),
        Heading(2, 'Results'),
        Para([t.paragraph(2)]),
        Table('Table 1. Results by region', ['Region', 'Measure', 'Outcome'],
              [[t.words(1).capitalize(), t.words(3), t.words(2)] for _ in range(4)]),
        Figure('chart.png', 'Bar chart of five regions; the fourth is highest and the first lowest',
               'Figure 1. Relative outcome by region'),
        Para([t.sentence(), ' ',
              Lang('fr', 'Les résultats détaillés figurent dans le tableau ci-dessus.'), ' ',
              t.sentence()]),
        Heading(2, 'Notes'),
        Para([t.paragraph(2)]),
    ])


def case2_footnotes() -> Doc:
    """Forty paragraphs, twenty footnotes, two of them long enough that they must split.

    Positions near page breaks are not engineered, because each engine breaks pages in a different
    place. Twenty notes across several pages land near a break in every engine without trying.
    """
    t = Text(2)
    blocks = [Heading(1, 'Footnote placement')]
    n = 0
    for i in range(40):
        if i % 2 == 1:
            n += 1
            # Note 5 fits on a fresh page, so an engine may move its anchor rather than split it.
            # Note 12 is longer than a page's footnote area can hold, so no engine can avoid the
            # question the gate asks: split it, clip it, overflow it, or drop it.
            size = {5: 34, 12: 80}.get(n)
            note = (f'note{n:02d} ' + (t.paragraph(size) if size else t.sentence(14, 30))
                    + f' end{n:02d}')
            blocks.append(Para([t.paragraph(3) + f' mark{n:02d}', Footnote(note),
                                ' ' + t.paragraph(2)]))
        else:
            blocks.append(Para([t.paragraph(5)]))
    return Doc('Footnote placement', blocks)


def case3_table() -> Doc:
    """A forty-row table crossing three pages, with a caption and a cell-anchored footnote."""
    t = Text(3)
    rows = []
    for r in range(1, 41):
        observation: list = [t.sentence(10, 16)]
        if r == 33:
            observation = [t.sentence(10, 16) + ' cellmark',
                           Footnote('cellnote ' + t.sentence(12, 18) + ' cellend')]
        rows.append([f'row{r:02d}', t.words(4), observation, t.words(3) + f' rowend{r:02d}'])
    return Doc('Table breaking', [
        Heading(1, 'Table breaking'),
        Para([t.paragraph(4)]),
        Table('Table 1. Measured values by site', ['Site', 'Measure', 'Observation', 'Outcome'],
              rows),
        Para([t.paragraph(3)]),
    ])


def case4_long(edit: int = 0) -> Doc:
    """Roughly three hundred pages: chapters, sections, footnotes, tables and figures.

    `edit=n` adds one sentence to a paragraph about an eighth of the way in - near page 40 -
    which forces everything after it to reflow. That is the realistic cost of typing, and the
    case the brief's gate is really about. Each n adds a different sentence, so an engine that
    caches layout cannot answer a second edit from its first.

    The added sentence comes from its own generator. Drawing it from the document's would shift
    every word after it, turning one edit into a rewrite of the rest of the document.
    """
    t = Text(4)
    blocks = []
    fn = 0
    section = 0
    for chapter in range(1, 21):
        blocks.append(Heading(1, f'Chapter {chapter}. {t.words(3).capitalize()}'))
        for s in range(1, 13):
            section += 1
            blocks.append(Heading(2, f'{chapter}.{s} {t.words(4).capitalize()}'))
            for p in range(7):
                parts: list = [t.paragraph(5)]
                if section == 30 and p == 3:
                    parts = [t.paragraph(5) + ' edittarget'
                             + (' ' + Text(1000 + edit).sentence(18, 18) if edit else '')]
                if p % 4 == 1:
                    fn += 1
                    parts.append(Footnote(t.sentence(14, 28)))
                    parts.append(' ' + t.paragraph(1))
                blocks.append(Para(parts))
            if section % 10 == 0:
                blocks.append(Table(f'Table {section // 10}. {t.words(3).capitalize()}',
                                    ['Item', 'Measure', 'Outcome'],
                                    [[t.words(2), t.words(3), t.words(2)] for _ in range(6)]))
            if section % 15 == 0:
                blocks.append(Figure('chart.png', 'Bar chart of five categories',
                                     f'Figure {section // 15}. {t.words(3).capitalize()}'))
    return Doc('Long document', blocks)


CASES = {
    'case1': case1_tagged,
    'case2': case2_footnotes,
    'case3': case3_table,
    'case4': case4_long,
}


def build(out: Path) -> None:
    for name, make in CASES.items():
        d = out / name
        d.mkdir(parents=True, exist_ok=True)
        write_chart_png(d / 'chart.png')
        doc = make()
        (d / 'case.html').write_text(to_html(doc), encoding='utf-8')
        (d / 'case.typ').write_text(to_typst(doc), encoding='utf-8')
    edited = case4_long(edit=1)
    (out / 'case4' / 'edited.html').write_text(to_html(edited), encoding='utf-8')
    for n in (1, 2, 3, 4):
        (out / 'case4' / f'edited{n}.typ').write_text(to_typst(case4_long(edit=n)),
                                                     encoding='utf-8')


if __name__ == '__main__':
    build(Path(__file__).parent / 'out' / 'cases')
    print('cases written')
