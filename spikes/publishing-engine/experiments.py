"""Throwaway. Follow-ups that turn a gate failure into a cost.

The brief scores a gate failure as "what would have to be built", so each failure worth pricing
gets one experiment here: change the smallest thing that might close it, and see whether it does.

  figure    - Chromium tags <figure> and <img> as two Figure elements and puts the alt text on only
              one. Does emitting the figure without <figure> close veraPDF 7.3-1?
  margin    - Chromium does not mark @page margin-box content (the page number) as an artifact.
              Does dropping margin boxes close 7.1-3? Running heads then need another mechanism.
  blocklang - WeasyPrint and Chromium lose lang on an inline span. Do they keep it on a block?
  xmp       - Chromium writes no XMP metadata stream (7.1-8). Does adding one afterwards close it?
"""

from __future__ import annotations

import re
from pathlib import Path

import pikepdf

import cases
from render import PDF, browser_render, weasyprint_render

EXP = Path(__file__).parent / 'out' / 'experiments'


def variant(html: str, name: str) -> str:
    if name in ('figure', 'all'):
        html = re.sub(r'<figure><img ([^>]*)/><figcaption>(.*?)</figcaption></figure>',
                      r'<div class="figure"><img \1/><p class="caption">\2</p></div>', html)
    if name in ('margin', 'all'):
        html = re.sub(r'@bottom-center \{[^}]*\}', '', html)
    if name in ('blocklang', 'all'):
        html = re.sub(r' <span lang="fr" xml:lang="fr">(.*?)</span> ',
                      r'</p><p lang="fr" xml:lang="fr">\1</p><p>', html)
    return html


def add_xmp(path: Path, title: str) -> None:
    with pikepdf.open(path, allow_overwriting_input=True) as pdf:
        with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
            meta['dc:title'] = title
            meta['pdfuaid:part'] = '1'
        pdf.save(path)


def main() -> None:
    EXP.mkdir(parents=True, exist_ok=True)
    src = (Path(__file__).parent / 'out' / 'cases' / 'case1')
    base = (src / 'case.html').read_text(encoding='utf-8')
    (EXP / 'chart.png').write_bytes((src / 'chart.png').read_bytes())
    for name in ('figure', 'margin', 'blocklang', 'all'):
        html = EXP / f'{name}.html'
        html.write_text(variant(base, name), encoding='utf-8')
        browser_render('chrome', html, PDF / f'exp-chrome-{name}.pdf')
        weasyprint_render(html, PDF / f'exp-weasyprint-{name}.pdf')
    # 'all' plus metadata added afterwards: the smallest post-processing that might close case 1.
    all_xmp = PDF / 'exp-chrome-all-xmp.pdf'
    all_xmp.write_bytes((PDF / 'exp-chrome-all.pdf').read_bytes())
    add_xmp(all_xmp, 'Method statement for the quarterly review')
    print('experiments rendered')


if __name__ == '__main__':
    main()
