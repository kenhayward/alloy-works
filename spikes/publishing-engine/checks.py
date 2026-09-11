"""Throwaway. Judges the rendered gate cases.

Each check works from what is in the PDF - text positions, font sizes, the structure tree - never
from what an engine claims to have done. Tokens planted by cases.py (mark07, note07, row12, ...)
are how things are found, so the same check applies to every engine however it lays a page out.

The recurring measure is "in the footnote area": a note's first word must sit below every word on
its page that is set larger than note text. Body is 11pt, table text 9.5pt, notes 9pt, so a note
set inline in a paragraph or a cell - which is what an engine without footnote support does - has
larger text below it and fails.
"""

from __future__ import annotations

import json
from pathlib import Path

import pdfplumber
import pikepdf

HERE = Path(__file__).parent
OUT = HERE / 'out'
PDF = OUT / 'pdf'
ENGINES = ['weasyprint', 'pagedjs', 'chrome', 'typst']
NOTE_SIZE_CEILING = 9.25  # anything larger is body or table text


def words(path: Path) -> list[list[dict]]:
    with pdfplumber.open(path) as pdf:
        return [p.extract_words(extra_attrs=['size'], keep_blank_chars=False) for p in pdf.pages]


def find(pages, prefix: str) -> list[tuple[int, dict]]:
    # Containment, not prefix: Typst sets a footnote's number flush against its first word
    # ('1note01'), and an engine setting a call flush after its anchor gives 'mark011'.
    return [(i + 1, w) for i, ws in enumerate(pages) for w in ws if prefix in w['text']]


def first(pages, prefix: str):
    hits = find(pages, prefix)
    return hits[0] if hits else (None, None)


def in_foot_area(page_words: list[dict], word: dict) -> bool:
    # Bare numbers are page numbers and note numbers, set at whatever size an engine chooses.
    larger = [w['bottom'] for w in page_words
              if w['size'] > NOTE_SIZE_CEILING and not w['text'].isdigit()]
    return not larger or word['top'] > max(larger)


# ---------------------------------------------------------------------------------------------
# Case 1 - tagged PDF. veraPDF is the verdict; the structure walk says what is actually there.
# ---------------------------------------------------------------------------------------------

def verapdf(name: str) -> dict:
    path = OUT / 'verapdf' / f'{name}.json'
    if not path.exists():
        return {'compliant': None}
    vr = json.loads(path.read_text())['report']['jobs'][0]['validationResult']
    vr = vr[0] if isinstance(vr, list) else vr
    return {'compliant': vr['compliant'], 'failed_rules': vr['details']['failedRules'],
            'failures': [f"{x['clause']}-{x['testNumber']} x{x['failedChecks']}"
                         for x in vr['details']['ruleSummaries']]}


def structure(path: Path) -> dict:
    with pikepdf.open(path) as pdf:
        root = pdf.Root
        tree = root.get('/StructTreeRoot')
        rolemap = dict(tree.get('/RoleMap', {})) if tree is not None else {}
        seen: dict[str, int] = {}
        found = {'figure_alt': False, 'th_scope': False, 'passage_lang': set()}

        def role(el) -> str:
            s = str(el.get('/S', ''))
            hops = 0
            while s in rolemap and hops < 8:
                s = str(rolemap[s])
                hops += 1
            return s.lstrip('/')

        def attrs(el) -> list:
            a = el.get('/A')
            if a is None:
                return []
            return list(a) if isinstance(a, pikepdf.Array) else [a]

        def walk(node, depth=0):
            if depth > 200 or not isinstance(node, pikepdf.Dictionary):
                if isinstance(node, pikepdf.Array):
                    for k in node:
                        walk(k, depth + 1)
                return
            if '/S' in node:
                r = role(node)
                seen[r] = seen.get(r, 0) + 1
                if r == 'Figure' and '/Alt' in node:
                    found['figure_alt'] = True
                if r == 'TH':
                    for a in attrs(node):
                        if isinstance(a, pikepdf.Dictionary) and '/Scope' in a:
                            found['th_scope'] = True
                if '/Lang' in node and str(node['/Lang']).lower().startswith('fr'):
                    found['passage_lang'].add(r)
            kids = node.get('/K')
            if kids is not None:
                walk(kids, depth + 1)

        if tree is not None:
            walk(tree.get('/K'))
        # Language may also be carried on marked content rather than a structure element
        # (ISO 32000-1 14.9.2). Typst does it this way; it is equally valid.
        for page in pdf.pages:
            for operands, op in pikepdf.parse_content_stream(page):
                if (str(op) == 'BDC' and len(operands) > 1
                        and isinstance(operands[1], pikepdf.Dictionary)
                        and str(operands[1].get('/Lang', '')).lower().startswith('fr')):
                    found['passage_lang'].add('marked-content')
        return {
            'tagged': tree is not None,
            'doc_lang': str(root.get('/Lang', '')) or None,
            'display_doc_title': bool(root.get('/ViewerPreferences', {}).get('/DisplayDocTitle',
                                                                          False)),
            'elements': {k: seen[k] for k in sorted(seen)
                         if k in ('H1', 'H2', 'L', 'LI', 'Table', 'TH', 'TD', 'Figure',
                                  'Caption', 'Note', 'FENote', 'Lbl', 'Link', 'Span', 'P')},
            'figure_alt': found['figure_alt'],
            'th_scope': found['th_scope'],
            'french_passage': sorted(found['passage_lang']),
        }


def check_case1(engine: str) -> dict:
    name = f'case1-{engine}'
    path = PDF / f'{name}.pdf'
    if not path.exists():
        return {'status': 'error'}
    v = verapdf(name)
    s = structure(path)
    # TH Scope is recorded, not gated: a header row in THead is structurally unambiguous,
    # which is why veraPDF accepts it. It becomes a cost for row headers and nested headers.
    semantics = (s['elements'].get('H1') and s['elements'].get('TH') and s['figure_alt']
                 and s['french_passage'] and s['doc_lang'])
    status = 'pass' if v['compliant'] and semantics else 'fail'
    return {'status': status, 'verapdf': v, 'structure': s}


# ---------------------------------------------------------------------------------------------
# Case 2 - every note on its anchor's page, in the footnote area; long ones continue.
# ---------------------------------------------------------------------------------------------

def check_case2(engine: str) -> dict:
    path = PDF / f'case2-{engine}.pdf'
    if not path.exists():
        return {'status': 'error'}
    pages = words(path)
    notes = []
    for n in range(1, 21):
        anchor_page, _ = first(pages, f'mark{n:02d}')
        note_page, note_word = first(pages, f'note{n:02d}')
        end_page, _ = first(pages, f'end{n:02d}')
        if note_page is None:
            state = 'dropped'
        elif not in_foot_area(pages[note_page - 1], note_word):
            state = 'inline'
        elif note_page != anchor_page:
            state = 'moved'
        elif end_page and end_page > note_page:
            state = 'split'
        else:
            state = 'ok'
        notes.append({'n': n, 'anchor': anchor_page, 'note': note_page, 'end': end_page,
                      'state': state})
    states = [x['state'] for x in notes]
    long_notes = [x for x in notes if x['n'] in (5, 12)]
    return {
        'status': 'pass' if all(s in ('ok', 'split') for s in states) else 'fail',
        'counts': {s: states.count(s) for s in sorted(set(states))},
        'long_notes': long_notes,
        'problems': [x for x in notes if x['state'] not in ('ok', 'split')][:6],
    }


# ---------------------------------------------------------------------------------------------
# Case 3 - repeated headers, caption with its table, cell footnote on its cell's page.
# ---------------------------------------------------------------------------------------------

def check_case3(engine: str) -> dict:
    path = PDF / f'case3-{engine}.pdf'
    if not path.exists():
        return {'status': 'error'}
    pages = words(path)
    starts = {r: first(pages, f'row{r:02d}') for r in range(1, 41)}
    ends = {r: first(pages, f'rowend{r:02d}')[0] for r in range(1, 41)}
    spanned = sorted({p for p, _ in starts.values() if p})

    header_missing = []
    for p in spanned:
        first_row_top = min(w['top'] for pg, w in starts.values() if pg == p)
        headers = [w for w in pages[p - 1] if w['text'] == 'Observation']
        if not any(h['top'] < first_row_top for h in headers):
            header_missing.append(p)

    caption_page, caption = first(pages, 'Measured')
    row1_page, row1 = starts[1]
    caption_ok = caption_page == row1_page and caption is not None and caption['top'] < row1['top']

    split_rows = [r for r in range(1, 41) if starts[r][0] and ends[r] and ends[r] != starts[r][0]]
    mark_page, _ = first(pages, 'cellmark')
    note_page, note_word = first(pages, 'cellnote')
    cell_note_ok = (note_page is not None and note_page == mark_page
                    and in_foot_area(pages[note_page - 1], note_word))
    continued = [p for p in spanned[1:] if any('continued' in w['text'].lower()
                                              for w in pages[p - 1])]
    return {
        'status': 'pass' if (not header_missing and caption_ok and cell_note_ok) else 'fail',
        'pages_spanned': spanned,
        'header_missing_on': header_missing,
        'caption_with_table': caption_ok,
        'cell_note': {'anchor': mark_page, 'note': note_page, 'ok': cell_note_ok,
                      'in_foot_area': (in_foot_area(pages[note_page - 1], note_word)
                                       if note_page else None)},
        'rows_split_across_pages': split_rows,
        'continuation_label': bool(continued),
    }


# ---------------------------------------------------------------------------------------------
# Case 4 - judged against a provisional budget, because the requirements state none.
# ---------------------------------------------------------------------------------------------

# CNT-096 requires preview "against a budget stated in the requirements", and no budget is stated.
# These are this spike's provisional numbers, chosen to be defensible rather than precise: under a
# second feels live, two seconds is the ceiling for "usable while writing".
EDIT_TARGET_MS = 1000
EDIT_CEILING_MS = 2000


def check_case4(engine: str, render: dict) -> dict:
    r = render.get('case4', {}).get(engine)
    if not r or 'error' in r:
        return {'status': 'error', 'detail': r}
    # A writer sees whichever comes first: PagedJS shows page 40 on screen before the PDF exists.
    felt = r.get('edit_onscreen_ms') or r['edit_ms']
    status = ('pass' if felt <= EDIT_TARGET_MS else
              'pass with cost' if felt <= EDIT_CEILING_MS else 'fail')
    return {'status': status, 'edit_to_page40_ms': felt, **r}


def main() -> None:
    render = json.loads((OUT / 'render.json').read_text())
    results = {
        'control': verapdf('case1-weasyprint-untagged-control'),
        'case1': {e: check_case1(e) for e in ENGINES},
        'case2': {e: check_case2(e) for e in ENGINES},
        'case3': {e: check_case3(e) for e in ENGINES},
        'case4': {e: check_case4(e, render) for e in ENGINES},
        'versions': render['versions'],
    }
    (OUT / 'results.json').write_text(json.dumps(results, indent=2, default=list))

    print(f"control (untagged) compliant={results['control']['compliant']} - must be False")
    print(f"{'':12s}" + ''.join(f'{e:>16s}' for e in ENGINES))
    for case in ('case1', 'case2', 'case3', 'case4'):
        print(f'{case:12s}' + ''.join(f"{results[case][e]['status']:>16s}" for e in ENGINES))


if __name__ == '__main__':
    main()
