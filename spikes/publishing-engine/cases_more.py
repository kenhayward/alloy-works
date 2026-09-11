"""Cases 5 to 8 of Publishing_Engine_Spike.md, for the two engines that survived the gates.

Built on cases.py's document model and emitters, extended with what these cases need: equations,
page regions (title, front matter, body, appendix), generated contents and lists of figures,
cross-references that print a page number, and a theme's typefaces.

Every page number a reader sees - in a footer, a contents line, a cross-reference - is left to the
engine to compute, because that is what an engine is for. Every *sequence* number (Figure 12,
equation (2)) is computed here, in what would be the resolve stage, because STR owns sequences and
PUB-002 puts resolution before rendering.
"""

from __future__ import annotations

import base64
import json
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from cases import (Bullets, Doc, Figure, Footnote, Heading, Lang, Para, Table, Text, _esc,
                   _typ_text, write_chart_png)

HERE = Path(__file__).parent


# ---------------------------------------------------------------------------------------------
# More of the document model.
# ---------------------------------------------------------------------------------------------

@dataclass
class Math:
    latex: str   # what the content model stores (CNT-044)
    typst: str   # hand-written Typst math, used only by the markup emitter
    alt: str     # the accessible alternative (CNT-048)
    block: bool = False
    numbered: bool = False


@dataclass
class Region:
    kind: str  # title | front | body | appendix
    blocks: list


@dataclass
class Contents:
    title: str = 'Contents'


@dataclass
class FigureList:
    title: str = 'List of figures'


@dataclass
class XRef:
    target: str  # a figure id


@dataclass
class References:
    entries: list


@dataclass
class Fig(Figure):
    id: str = ''


@dataclass
class BookDoc(Doc):
    layout: str = 'book'
    body_font: str = 'Liberation Serif'
    heading_font: str = 'Liberation Serif'
    font_faces: dict = field(default_factory=dict)  # family -> file, for self-hosted faces


# ---------------------------------------------------------------------------------------------
# Equations for WeasyPrint: pre-rendered by MathJax to SVG, because WeasyPrint has no MathML.
# ---------------------------------------------------------------------------------------------

EX_PT = 0.431 * 11  # MathJax's ex is 0.431em; body text is 11pt


def mathjax_svgs(items: list[Math]) -> dict:
    if not items:
        return {}
    payload = json.dumps([{'latex': m.latex, 'display': m.block} for m in items])
    out = subprocess.run(['node', str(HERE / 'mathsvg.mjs')], input=payload, capture_output=True,
                         text=True, check=True).stdout
    return {(m.latex, m.block): r for m, r in zip(items, json.loads(out))}


def walk(blocks):
    for b in blocks:
        yield b
        if isinstance(b, Region):
            yield from walk(b.blocks)
        for attr in ('parts',):
            for p in getattr(b, attr, []) or []:
                yield p
                if isinstance(p, Footnote) and isinstance(p.text, list):
                    yield from p.text
        if isinstance(b, Table):
            yield from (x for row in b.rows for cell in row if isinstance(cell, list) for x in cell)
            if isinstance(b.caption, list):
                yield from b.caption
        if isinstance(b, Heading) and isinstance(b.text, list):
            yield from b.text
        if isinstance(b, Figure) and isinstance(b.caption, list):
            yield from b.caption


# ---------------------------------------------------------------------------------------------
# Emitter 1, extended: XHTML + CSS Paged Media, for WeasyPrint.
# ---------------------------------------------------------------------------------------------

BOOK_CSS = """
@page { size: A4; margin: 25mm 22mm 28mm 22mm;
        @top-center { content: string(chapter, first-except); font: 9pt "Liberation Serif"; }
        @bottom-center { content: counter(page); font: 9pt "Liberation Serif"; } }
@page title { @top-center { content: none; } @bottom-center { content: none; } }
@page front { @top-center { content: none; } @bottom-center { content: counter(page, lower-roman); } }
@page appendix { @bottom-center { content: "A-" counter(page); } }
section.title { page: title; }
section.front { page: front; break-before: page; }
section.body { page: body; break-before: page; }
section.appendix { page: appendix; break-before: page; }
/* Restarting a page counter needs a page group; counter-reset on an element is ignored. */
@page body:nth(1 of body) { counter-reset: page 1; }
@page appendix:nth(1 of appendix) { counter-reset: page 1; }
section > h1:first-child { break-before: auto; }
h1 { string-set: chapter content(text); break-before: page; }
.toc ul, .lof ul { list-style: none; padding: 0; }
.toc a, .lof a { color: inherit; text-decoration: none; }
.toc a::after, .lof a::after { content: leader('.') target-counter(attr(href), page); }
a.pageref::after { content: target-counter(attr(href), page); }
.eq { display: flex; justify-content: space-between; align-items: center; margin: 6pt 0; }
.eq img { margin: 0 auto; }
"""


class HtmlEmitter:
    def __init__(self, doc: BookDoc, svgs: dict):
        self.doc, self.svgs = doc, svgs
        self.eq_no = 0
        self.h_no = 0
        self.headings: list[tuple[str, str, int]] = []
        self.figures: list[tuple[str, str]] = []

    def math(self, m: Math) -> str:
        r = self.svgs[(m.latex, m.block)]
        data = base64.b64encode(r['svg'].encode()).decode()
        style = (f"width:{r['w'] * EX_PT:.2f}pt;height:{r['h'] * EX_PT:.2f}pt;"
                 f"vertical-align:{r['valign'] * EX_PT:.2f}pt")
        img = (f'<img class="math" style="{style}" alt="{_esc(m.alt)}" '
               f'src="data:image/svg+xml;base64,{data}"/>')
        if not m.block:
            return img
        number = ''
        if m.numbered:
            self.eq_no += 1
            number = f'<span class="eqno">({self.eq_no})</span>'
        return f'<div class="eq"><span></span>{img}{number or "<span></span>"}</div>'

    def inline(self, parts) -> str:
        if isinstance(parts, str):
            return _esc(parts)
        out = []
        for p in parts:
            if isinstance(p, Footnote):
                out.append(f'<span class="fn">{self.inline(p.text)}</span>')
            elif isinstance(p, Lang):
                out.append(f'<span lang="{p.lang}">{_esc(p.text)}</span>')
            elif isinstance(p, Math):
                out.append(self.math(p))
            elif isinstance(p, XRef):
                n = next(i for i, (fid, _) in enumerate(self.figures_all, 1) if fid == p.target)
                out.append(f'<a href="#{p.target}">Figure {n}</a> on page '
                           f'<a class="pageref" href="#{p.target}"></a>')
            else:
                out.append(_esc(p))
        return ''.join(out)

    def text_of(self, parts) -> str:
        if isinstance(parts, str):
            return parts
        return ''.join(p if isinstance(p, str) else '' for p in parts)

    def blocks(self, blocks) -> str:
        out = []
        for b in blocks:
            if isinstance(b, Region):
                out.append(f'<section class="{b.kind}">{self.blocks(b.blocks)}</section>')
            elif isinstance(b, Heading):
                self.h_no += 1
                hid = f'h-{self.h_no}'
                self.headings.append((hid, self.text_of(b.text), b.level))
                out.append(f'<h{b.level} id="{hid}">{self.inline(b.text)}</h{b.level}>')
            elif isinstance(b, Para):
                out.append(f'<p>{self.inline(b.parts)}</p>')
            elif isinstance(b, Bullets):
                out.append('<ul>' + ''.join(f'<li>{self.inline(i)}</li>' for i in b.items) + '</ul>')
            elif isinstance(b, Math):
                out.append(self.math(b))
            elif isinstance(b, Table):
                head = ''.join(f'<th scope="col">{_esc(h)}</th>' for h in b.header)
                rows = ''.join('<tr>' + ''.join(f'<td>{self.inline(c)}</td>' for c in row) + '</tr>'
                               for row in b.rows)
                out.append(f'<table><caption>{self.inline(b.caption)}</caption>'
                           f'<thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>')
            elif isinstance(b, Figure):
                fid = getattr(b, 'id', '') or ''
                n = len(self.figures) + 1
                self.figures.append((fid, self.text_of(b.caption)))
                out.append(f'<figure id="{fid}"><img src="{b.src}" alt="{_esc(b.alt)}"/>'
                           f'<figcaption>Figure {n}. {self.inline(b.caption)}</figcaption></figure>')
            elif isinstance(b, Contents):
                out.append('<nav class="toc"><h1>' + _esc(b.title) + '</h1>__TOC__</nav>')
            elif isinstance(b, FigureList):
                out.append('<nav class="lof"><h1>' + _esc(b.title) + '</h1>__LOF__</nav>')
            elif isinstance(b, References):
                out.append('<h1>References</h1><ol>' + ''.join(f'<li>{_esc(e)}</li>'
                                                            for e in b.entries) + '</ol>')
        return ''.join(out)

    def render(self) -> str:
        from cases import CSS
        d = self.doc
        self.figures_all = [(getattr(b, 'id', ''), '') for b in walk(d.blocks) if isinstance(b, Figure)]
        body = self.blocks(d.blocks)
        toc = '<ul>' + ''.join(
            f'<li style="margin-left:{(lvl - 1) * 12}pt"><a href="#{hid}">{_esc(t)}</a></li>'
            for hid, t, lvl in self.headings if lvl <= 2 and t not in ('Contents', 'List of figures')
        ) + '</ul>'
        lof = '<ul>' + ''.join(f'<li><a href="#{fid}">Figure {i}. {_esc(t)}</a></li>'
                               for i, (fid, t) in enumerate(self.figures, 1)) + '</ul>'
        body = body.replace('__TOC__', toc).replace('__LOF__', lof)
        faces = ''.join(f'@font-face {{ font-family: "{fam}"; src: url("{f}"); }}\n'
                        for fam, f in d.font_faces.items())
        fonts = (f'html {{ font-family: "{d.body_font}"; }} '
                 f'h1, h2 {{ font-family: "{d.heading_font}"; }}')
        css = CSS + (BOOK_CSS if d.layout == 'book' else '') + faces + fonts
        return (f'<!DOCTYPE html>\n<html lang="{d.lang}"><head><meta charset="utf-8"/>'
                f'<title>{_esc(d.title)}</title><style>{css}</style></head>'
                f'<body>{body}</body></html>\n')


# ---------------------------------------------------------------------------------------------
# Emitter 2, extended: Typst markup. The shape the recommendation rejects, kept for comparison.
# ---------------------------------------------------------------------------------------------

TYPST_BOOK = r"""
#let running = context {
  let p = here().page()
  let hs = query(heading.where(level: 1))
  if not hs.any(h => h.location().page() == p) {
    let prev = hs.filter(h => h.location().page() < p)
    if prev.len() > 0 { align(center, text(size: 9pt, prev.last().body)) }
  }
}
#show heading.where(level: 1): it => { pagebreak(weak: true); it }
"""


def typst_preamble(d: BookDoc) -> str:
    from cases import TYPST_PREAMBLE
    return (f'#set document(title: [{_typ_text(d.title)}])\n#set text(lang: "{d.lang}")\n'
            + TYPST_PREAMBLE
            + f'#set text(font: "{d.body_font}")\n'
            + f'#show heading: set text(font: "{d.heading_font}")\n'
            + (TYPST_BOOK if d.layout == 'book' else ''))


REGION_TYPST = {
    'title': '#set page(numbering: none, header: none)\n',
    'front': '#set page(numbering: "i", header: none)\n#counter(page).update(2)\n',
    'body': '#set page(numbering: "1", header: running)\n#counter(page).update(1)\n',
    'appendix': '#set page(numbering: (..n) => "A-" + str(n.pos().first()), header: running)\n'
                '#counter(page).update(1)\n',
}


class TypstEmitter:
    def __init__(self, doc: BookDoc):
        self.doc = doc

    def math(self, m: Math) -> str:
        numbering = '"(1)"' if m.numbered else 'none'
        return (f'#math.equation(block: {str(m.block).lower()}, numbering: {numbering}, '
                f'alt: "{m.alt}", ${m.typst}$.body)')

    def inline(self, parts) -> str:
        if isinstance(parts, str):
            return _typ_text(parts)
        out = []
        for p in parts:
            if isinstance(p, Footnote):
                out.append(f'#footnote[{self.inline(p.text)}]')
            elif isinstance(p, Lang):
                out.append(f'#text(lang: "{p.lang}")[{_typ_text(p.text)}]')
            elif isinstance(p, Math):
                out.append(self.math(p))
            elif isinstance(p, XRef):
                out.append(f'#ref(<{p.target}>) on #ref(<{p.target}>, form: "page")')
            else:
                out.append(_typ_text(p))
        return ''.join(out)

    def blocks(self, blocks) -> list[str]:
        out = []
        for b in blocks:
            if isinstance(b, Region):
                out.append(REGION_TYPST[b.kind] if self.doc.layout == 'book' else '')
                out.extend(self.blocks(b.blocks))
            elif isinstance(b, Heading):
                out.append('=' * b.level + ' ' + self.inline(b.text))
            elif isinstance(b, Para):
                out.append(self.inline(b.parts) + '\n')
            elif isinstance(b, Bullets):
                out.append('\n'.join('- ' + self.inline(i) for i in b.items) + '\n')
            elif isinstance(b, Math):
                out.append(self.math(b) + '\n')
            elif isinstance(b, Table):
                header = ', '.join(f'[*{_typ_text(h)}*]' for h in b.header)
                cells = ', '.join(f'[{self.inline(c)}]' for row in b.rows for c in row)
                out.append(f'#figure(caption: [{self.inline(b.caption)}], table(columns: '
                           f'{len(b.header)}, align: left, table.header({header}), {cells}))\n')
            elif isinstance(b, Figure):
                label = f' <{b.id}>' if getattr(b, 'id', '') else ''
                out.append(f'#figure(image("{b.src}", width: 60mm, alt: "{b.alt}"), '
                           f'caption: [{self.inline(b.caption)}]){label}\n')
            elif isinstance(b, Contents):
                out.append(f'#outline(title: [{b.title}], depth: 2)\n')
            elif isinstance(b, FigureList):
                out.append(f'#outline(title: [{b.title}], target: figure.where(kind: image))\n')
            elif isinstance(b, References):
                out.append('= References\n' + '\n'.join('+ ' + _typ_text(e) for e in b.entries)
                           + '\n')
        return out

    def render(self) -> str:
        return typst_preamble(self.doc) + '\n'.join(self.blocks(self.doc.blocks)) + '\n'


# ---------------------------------------------------------------------------------------------
# The cases.
# ---------------------------------------------------------------------------------------------

EQ = {
    'inline': Math('E = mc^2', 'E = m c^2', 'E equals m c squared'),
    'heading': Math(r'\sum_{i=1}^{n} x_i', 'sum_(i=1)^n x_i', 'sum of x i for i from 1 to n'),
    'cell': Math(r'\frac{a}{b}', 'a / b', 'a over b'),
    'footnote': Math(r'\sqrt{x^2 + y^2}', 'sqrt(x^2 + y^2)', 'square root of x squared plus y squared'),
    'caption': Math(r'\alpha + \beta', 'alpha + beta', 'alpha plus beta'),
    'block1': Math(r'\int_0^1 f(x)\,dx = F(1) - F(0)', 'integral_0^1 f(x) dif x = F(1) - F(0)',
                   'integral from 0 to 1 of f of x d x equals F of 1 minus F of 0', True, True),
    'unnumbered': Math('a^2 + b^2 = c^2', 'a^2 + b^2 = c^2', 'a squared plus b squared equals c squared',
                       True, False),
    'block2': Math(r'\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n = e',
                   'lim_(n -> infinity) (1 + 1/n)^n = e',
                   'limit as n tends to infinity of 1 plus 1 over n to the n equals e', True, True),
}

# Text that is Typst markup and code. In data mode it must come out as literally these characters.
HOSTILE = 'hostile: #read("secret.txt") and $x^2$ and *bold* and <label> and @ref end'


def case5_maths(hostile: bool = False) -> BookDoc:
    """`hostile=True` adds an equation whose LaTeX carries Typst code - for the data shape only,
    since it is the LaTeX-to-Typst route that would be tempted to eval."""
    t = Text(5)
    tail = ([' and ', Math(r'\text{#read("secret.txt")}', '', 'hostile equation')]
            if hostile else [])
    return BookDoc('Mathematics', [
        Heading(1, 'Mathematics'),
        Para(['mathrun ' + t.sentence() + ' ', EQ['inline'], ' ' + t.sentence()]),
        Heading(2, ['mathhead Summation ', EQ['heading'], ' over a sample']),
        Para([t.paragraph(2) + ' mathfn', Footnote(['mathnote ', EQ['footnote'], ' end.'])]),
        EQ['block1'],
        Para(['mathbetween ' + t.sentence()]),
        EQ['unnumbered'],
        Para([t.sentence()]),
        EQ['block2'],
        Table(['Ratios ', EQ['caption']], ['Case', 'Ratio'],
              [['mathcell', ['ratio ', EQ['cell']]], ['other', ['none']]]),
        Para([HOSTILE] + tail),
    ], layout='plain')


def case6_furniture() -> BookDoc:
    t = Text(6)

    def chapter(title: str, token: str, sections: int) -> list:
        out = [Heading(1, title)]
        for s in range(sections):
            out.append(Heading(2, f'{t.words(3).capitalize()}'))
            out.extend(Para([f'{token} ' + t.paragraph(6)]) for _ in range(4))
        return out

    return BookDoc('Page furniture', [
        Region('title', [Heading(1, 'Page furniture'), Para(['intitle ' + t.sentence()])]),
        Region('front', [Heading(1, 'Preface')]
               + [Para(['infront ' + t.paragraph(6)]) for _ in range(12)]),
        Region('body', chapter('Chapter one', 'inchapter1', 3) + chapter('Chapter two', 'inchapter2', 3)
               + chapter('Chapter three', 'inchapter3', 3)),
        Region('appendix', chapter('Appendix A. Supporting data', 'inappendix', 3)),
    ])


def case7_typefaces(missing: bool) -> BookDoc:
    """Two self-hosted faces, as ADR-0010 prescribes. With missing=True, the heading face's file
    is not where the theme says it is."""
    t = Text(7)
    heading = 'Theme Missing Sans' if missing else 'Noto Sans'
    return BookDoc('Typefaces', [
        Heading(1, 'Typeface heading'),
        Para([t.paragraph(4)]),
        Heading(2, 'Second heading'),
        Para([t.paragraph(4)]),
    ], layout='plain', body_font='Liberation Serif', heading_font=heading,
        font_faces={'Liberation Serif': 'fonts/LiberationSerif-Regular.ttf',
                    heading: ('fonts/ThemeMissingSans.ttf' if missing
                              else 'fonts/NotoSans-Regular.ttf')})


def case8_long(scale: float = 1.0) -> BookDoc:
    """400 components, 60 figures, 40 tables, 200 footnotes, contents, a list of figures, twenty
    cross-references that print a page number, and a reference list - at `scale` of that size."""
    t = Text(8)
    n_sections = round(400 * scale)
    figs = {round(i * n_sections / (60 * scale)) for i in range(round(60 * scale))}
    tables = {round(i * n_sections / (40 * scale)) + 3 for i in range(round(40 * scale))}
    blocks: list = []
    fig_ids: list[str] = []
    xrefs_placed = 0
    for s in range(n_sections):
        if s % 20 == 0:
            blocks.append(Heading(1, f'Chapter {s // 20 + 1}. {t.words(3).capitalize()}'))
        blocks.append(Heading(2, f'sec{s:03d} {t.words(4).capitalize()}'))
        for p in range(4):
            parts: list = [t.paragraph(4)]
            if p == 1 and s % 2 == 0:
                parts += [Footnote(t.sentence(12, 24)), ' ' + t.sentence()]
            if p == 2 and s % 7 == 0:
                parts.append(f' [{(s % 50) + 1}]')
            if p == 3 and fig_ids and xrefs_placed < round(20 * scale) and s % 19 == 5:
                xrefs_placed += 1
                parts += [f' xref{xrefs_placed:02d} see ', XRef(fig_ids[len(fig_ids) // 2]), '.']
            blocks.append(Para(parts))
        if s in figs:
            fid = f'fig-{len(fig_ids) + 1}'
            fig_ids.append(fid)
            blocks.append(Fig('chart.png', 'Bar chart of five categories',
                              f'fig{len(fig_ids):02d} {t.words(3)}', id=fid))
        if s in tables:
            blocks.append(Table(f'Table. {t.words(3).capitalize()}', ['Item', 'Measure', 'Outcome'],
                                [[t.words(2), t.words(3), t.words(2)] for _ in range(8)]))
    refs = References([f'Author{i:02d}, A. ({2000 + i % 25}). {t.words(6).capitalize()}. '
                       f'Journal of {t.words(2).capitalize()}, {i}({i % 4 + 1}), {i * 3}-{i * 3 + 9}.'
                       for i in range(1, 51)])
    return BookDoc('Long document', [
        Region('body', [Contents(), FigureList()] + blocks + [refs]),
    ], layout='book')


MORE = {'case5': case5_maths, 'case6': case6_furniture, 'case8': case8_long}


def emit(doc: BookDoc, d: Path) -> None:
    d.mkdir(parents=True, exist_ok=True)
    write_chart_png(d / 'chart.png')
    maths = [b for b in walk(doc.blocks) if isinstance(b, Math)]
    (d / 'case.html').write_text(HtmlEmitter(doc, mathjax_svgs(maths)).render(), encoding='utf-8')
    (d / 'case.typ').write_text(TypstEmitter(doc).render(), encoding='utf-8')


def build(out: Path) -> None:
    for name, make in MORE.items():
        emit(make(), out / name)
    for scale in (0.25, 0.5):
        emit(case8_long(scale), out / f'case8-{scale}')
    for missing in (False, True):
        emit(case7_typefaces(missing), out / ('case7-missing' if missing else 'case7'))


if __name__ == '__main__':
    build(HERE / 'out' / 'cases')
    print('cases 5 to 8 written')
