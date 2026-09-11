"""Throwaway. Judges cases 5 to 8, and the gates re-run in the recommended shape.

Same rule as checks.py: everything is read out of the PDF - text positions, the structure tree, the
outline, the fonts - never taken from what an engine reports about itself.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pdfplumber
import pikepdf

import checks
from cases_more import EQ, HOSTILE
from run_more import SECRET

HERE = Path(__file__).parent
OUT = HERE / 'out'
PDF = OUT / 'pdf'
FINALISTS = ['weasyprint', 'typst', 'typst-data']


def pages_words(path: Path):
    with pdfplumber.open(path) as pdf:
        return [(p.height, p.extract_words(extra_attrs=['size'])) for p in pdf.pages]


def text_of(path: Path) -> str:
    with pdfplumber.open(path) as pdf:
        return '\n'.join(p.extract_text() or '' for p in pdf.pages)


def struct_alts(path: Path) -> dict[str, list[str]]:
    """Alternative text found in the structure tree, by role."""
    out: dict[str, list[str]] = {}
    with pikepdf.open(path) as pdf:
        tree = pdf.Root.get('/StructTreeRoot')
        if tree is None:
            return out
        rolemap = dict(tree.get('/RoleMap', {}))

        def walk(n, depth=0):
            if depth > 300:
                return
            if isinstance(n, pikepdf.Array):
                for k in n:
                    walk(k, depth + 1)
            elif isinstance(n, pikepdf.Dictionary):
                if '/S' in n:
                    role = str(n['/S'])
                    role = str(rolemap.get(role, role)).lstrip('/')
                    if '/Alt' in n:
                        out.setdefault(role, []).append(str(n['/Alt']))
                if '/K' in n:
                    walk(n['/K'], depth + 1)
        walk(tree.get('/K'))
    return out


def outline_titles(path: Path) -> list[str]:
    with pikepdf.open(path) as pdf:
        with pdf.open_outline() as outline:
            titles = []

            def walk(items):
                for it in items:
                    titles.append(it.title)
                    walk(it.children)
            walk(outline.root)
            return titles


# ---------------------------------------------------------------------------------------------
# Case 5 - mathematics in every position, reachable by its textual alternative.
# ---------------------------------------------------------------------------------------------

EXPECTED_ALTS = {m.alt for m in EQ.values()}


def check_case5(engine: str) -> dict:
    path = PDF / f'case5-{engine}.pdf'
    if not path.exists():
        return {'status': 'error'}
    alts = struct_alts(path)
    found = {a for role in ('Formula', 'Figure') for a in alts.get(role, []) if a in EXPECTED_ALTS}
    text = text_of(path)
    heading = [t for t in outline_titles(path) if 'mathhead' in t]
    v = checks.verapdf(f'case5-{engine}')
    numbering = {'(1)': '(1)' in text, '(2)': '(2)' in text, 'no (3)': '(3)' not in text}
    result = {
        'verapdf': v,
        'equations_with_alt': f'{len(found)} of {len(EXPECTED_ALTS)}',
        'alt_role': sorted(r for r in alts if set(alts[r]) & EXPECTED_ALTS),
        'missing': sorted(EXPECTED_ALTS - found),
        'numbering': numbering,
        'math_as_text': any(ch in text for ch in '∑∫√'),
        'heading_bookmark': heading[0] if heading else None,
    }
    if engine == 'typst-data':
        flat = re.sub(r'\s+', ' ', text)
        result['hostile_text_literal'] = HOSTILE in flat
        result['hostile_equation_literal'] = '#read("secret.txt")' in flat.split(HOSTILE)[-1]
        result['secret_leaked'] = SECRET in text
    ok = (v['compliant'] and not result['missing'] and all(numbering.values())
          and not result.get('secret_leaked'))
    result['status'] = 'pass' if ok else 'fail'
    return result


def check_hostile_markup() -> dict:
    path = PDF / 'hostile.pdf'
    return {'compiled': path.exists(), 'secret_leaked': path.exists() and SECRET in text_of(path)}


# ---------------------------------------------------------------------------------------------
# Case 6 - numbering schemes and running heads, page by page.
# ---------------------------------------------------------------------------------------------

CHAPTERS = {'inchapter1': 'Chapter one', 'inchapter2': 'Chapter two',
            'inchapter3': 'Chapter three', 'inappendix': 'Appendix A. Supporting data'}


def roman(n: int) -> str:
    vals = [(10, 'x'), (9, 'ix'), (5, 'v'), (4, 'iv'), (1, 'i')]
    out = ''
    for v, s in vals:
        while n >= v:
            out, n = out + s, n - v
    return out


def check_case6(engine: str) -> dict:
    path = PDF / f'case6-{engine}.pdf'
    if not path.exists():
        return {'status': 'error'}
    problems, seen = [], []
    front_n, body_n, app_n = 1, 0, 0  # the title page is i
    current_chapter = ''
    for i, (height, ws) in enumerate(pages_words(path), 1):
        tokens = {w['text'] for w in ws}
        # A page holding only the tail of a paragraph carries no token; it belongs to whatever
        # region and chapter the page before it did. (Missing this made the first run fail Typst.)
        region = ('title' if 'intitle' in tokens else 'front' if 'infront' in tokens
                  else 'appendix' if 'inappendix' in tokens
                  else 'body' if tokens & {'inchapter1', 'inchapter2', 'inchapter3'}
                  else (seen[-1][1] if seen else '?'))
        chapter = next((CHAPTERS[t] for t in CHAPTERS if t in tokens), '') or current_chapter
        current_chapter = chapter
        starts = any(w['size'] > 16 and w['text'] in ('Chapter', 'Appendix') for w in ws)
        footer = ' '.join(w['text'] for w in ws if w['top'] > height - 79)
        header = ' '.join(w['text'] for w in ws if w['bottom'] < 71)
        if region == 'title':
            want_foot = ''
        elif region == 'front':
            front_n += 1
            want_foot = roman(front_n)
        elif region == 'body':
            body_n += 1
            want_foot = str(body_n)
        else:
            app_n += 1
            want_foot = f'A-{app_n}'
        want_head = '' if (region in ('title', 'front') or starts) else chapter
        seen.append((i, region, footer, header))
        if footer != want_foot:
            problems.append(f'p{i} ({region}) footer {footer!r}, expected {want_foot!r}')
        if header != want_head:
            problems.append(f'p{i} ({region}) head {header!r}, expected {want_head!r}')
    with pikepdf.open(path) as pdf:
        labels = '/PageLabels' in pdf.Root
    return {'status': 'pass' if not problems else 'fail', 'pages': len(seen),
            'problems': problems[:8], 'problem_count': len(problems), 'pdf_page_labels': labels,
            'verapdf': checks.verapdf(f'case6-{engine}')}


# ---------------------------------------------------------------------------------------------
# Case 7 - typefaces embed, and a missing one fails rather than substituting.
# ---------------------------------------------------------------------------------------------

def fonts_in(path: Path) -> list[dict]:
    found = {}
    with pikepdf.open(path) as pdf:
        for page in pdf.pages:
            for _, font in (page.get('/Resources', {}).get('/Font', {}) or {}).items():
                base = str(font.get('/BaseFont', '?')).lstrip('/')
                desc = font.get('/FontDescriptor')
                if desc is None and '/DescendantFonts' in font:
                    desc = font['/DescendantFonts'][0].get('/FontDescriptor')
                embedded = desc is not None and any(k in desc for k in
                                                      ('/FontFile', '/FontFile2', '/FontFile3'))
                found[base] = {'font': base.split('+')[-1], 'embedded': embedded,
                               'subset': bool(re.match(r'^[A-Z]{6}\+', base))}
    return list(found.values())


def check_case7(more: dict) -> dict:
    out = {}
    for key, r in more['case7'].items():
        path = PDF / f'{key}.pdf'
        fonts = fonts_in(path) if path.exists() else []
        warned = bool(re.search(r'font', r.get('stderr') or '', re.I))
        out[key] = {'exit': r.get('code'), 'warned': warned,
                    'warning': (r.get('stderr') or '').strip().splitlines()[:3],
                    'fonts': sorted({f['font'] for f in fonts}),
                    'all_embedded': all(f['embedded'] for f in fonts) if fonts else None,
                    'all_subset': all(f['subset'] for f in fonts) if fonts else None}
    return out


# ---------------------------------------------------------------------------------------------
# Case 8 - the long document: time, memory, linearity, and every generated page number right.
# ---------------------------------------------------------------------------------------------

PUBLISH_BUDGET_MS = 30_000  # provisional: scope §11 promises a number and none is stated


def displayed_labels(pages) -> list[str]:
    labels = []
    for height, ws in pages:
        foot = [w['text'] for w in ws if w['top'] > height - 79 and re.fullmatch(r'\d+', w['text'])]
        labels.append(foot[-1] if foot else '')
    return labels


def number_at_line_end(ws, word) -> str | None:
    line = [w for w in ws if abs(w['top'] - word['top']) < 3 and w['x0'] > word['x0']]
    if not line:
        return None
    m = re.search(r'(\d+)$', max(line, key=lambda w: w['x1'])['text'])
    return m.group(1) if m else None


def check_case8(engine: str) -> dict:
    path = PDF / f'case8-{engine}.pdf'
    if not path.exists():
        return {'status': 'error'}
    pages = pages_words(path)
    labels = displayed_labels(pages)

    def occurrences(token):
        return [(i, w) for i, (_, ws) in enumerate(pages) for w in ws if token in w['text']]

    def listing_ok(token):
        hits = occurrences(token)
        if len(hits) < 2:
            return None
        (li, lw), (bi, _) = hits[0], hits[-1]
        return number_at_line_end(pages[li][1], lw) == labels[bi]

    toc = [listing_ok(f'sec{s:03d}') for s in range(400)]
    lof = [listing_ok(f'fig{n:02d}') for n in range(1, 61)]
    misses = ([f'sec{s:03d}' for s, x in enumerate(toc) if not x]
              + [f'fig{n:02d}' for n, x in enumerate(lof, 1) if not x])
    xrefs = []
    for i, (_, ws) in enumerate(pages):
        flat = ' '.join(w['text'] for w in ws)
        for m in re.finditer(r'xref\d\d see Figure (\d+) on page (?:page )?(\d+)', flat):
            target = occurrences(f'fig{int(m.group(1)):02d}')
            ok = bool(target) and labels[target[-1][0]] == m.group(2)
            xrefs.append(ok)
            if not ok:
                misses.append(f'{m.group(0)} (figure is on page '
                              f'{labels[target[-1][0]] if target else "?"})')
    return {
        'toc_correct': f'{sum(1 for x in toc if x)} of {len(toc)}',
        'toc_unfound': sum(1 for x in toc if x is None),
        'lof_correct': f'{sum(1 for x in lof if x)} of {len(lof)}',
        'xrefs_correct': f'{sum(xrefs)} of {len(xrefs)}',
        'ok': all(toc) and all(lof) and xrefs and all(xrefs),
        'misses': misses[:6],
    }


def main() -> None:
    more = json.loads((OUT / 'more.json').read_text())
    results = {
        'case5': {e: check_case5(e) for e in FINALISTS},
        'hostile_markup': check_hostile_markup(),
        'case6': {e: check_case6(e) for e in FINALISTS},
        'case7': check_case7(more),
        'case8': {e: check_case8(e) for e in FINALISTS},
        'case8_timing': more['case8'],
        'gates_data': {
            'case1': checks.check_case1('typst-data'),
            'case2': checks.check_case2('typst-data'),
            'case3': checks.check_case3('typst-data'),
            'case4': more['gates_data']['case4'],
        },
    }
    (OUT / 'more_results.json').write_text(json.dumps(results, indent=2, default=list))
    print(json.dumps({k: (v if k != 'case8_timing' else '...') for k, v in results.items()},
                     indent=1, default=list)[:6000])


if __name__ == '__main__':
    main()
