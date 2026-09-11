"""Throwaway. Compares the three renderings of the fixture document.

For each line: its baseline, relative to the first line's, and its start, relative to the body's
left edge. For each token and each marked word: size, weight, posture and colour, against what the
resolved theme says they should be. PDF positions come from each character's text matrix, which is
where the glyph's baseline actually is, not its bounding box.

  editor   Chromium, the CSS projection            out/css.json
  pdf      Typst, the template with theme.json      out/typst.pdf
  word     LibreOffice, styles.xml + wordRun runs   out/word.pdf  (a proxy for Word, and said to be)
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pdfplumber

OUT = Path(__file__).parent / 'out'
TOLERANCE = 0.5  # points
TARGETS = ('editor', 'pdf', 'word')


def hex_colour(value) -> str:
    if isinstance(value, str):  # CSS: rgb(26, 26, 26)
        r, g, b = (int(n) for n in re.findall(r'\d+', value)[:3])
    elif value is None:
        return '?'
    elif len(value) == 1:
        r = g = b = round(value[0] * 255)
    else:
        r, g, b = (round(c * 255) for c in value[:3])
    return f'#{r:02x}{g:02x}{b:02x}'


def from_pdf(path: Path) -> dict:
    with pdfplumber.open(path) as pdf:
        page = pdf.pages[0]
        lines, words = [], []
        for hit in page.search(r'T\dx', regex=True, return_chars=True):
            c = hit['chars'][0]
            lines.append({'token': hit['text'], 'y': page.height - c['matrix'][5], 'x': c['x0'],
                          'size': c['size'], 'bold': 'Bold' in c['fontname'],
                          'italic': 'Italic' in c['fontname'],
                          'colour': c.get('non_stroking_color'), 'family': c['fontname']})
        for word in ('strongword', 'headword', 'bothword'):
            for hit in page.search(rf'\b{word}\b', regex=True, return_chars=True):
                c = hit['chars'][0]
                words.append({'word': word, 'size': c['size'], 'bold': 'Bold' in c['fontname'],
                              'italic': 'Italic' in c['fontname'],
                              'colour': c.get('non_stroking_color'), 'family': c['fontname']})
    return {'lines': lines, 'words': words, 'pages': 1}


def expectations() -> tuple[dict, dict]:
    """What the resolved theme says each token and word should be."""
    theme = json.loads((OUT / 'typst' / 'theme.json').read_text())
    doc = json.loads((OUT / 'typst' / 'doc.json').read_text())
    tokens, words = {}, {}
    for block in doc['blocks']:
        s = theme['styles'][block['style']]
        for line in block['lines']:
            tokens[line[0]['text'].split(' ')[0]] = {
                'style': block['style'], 'size': s['size'], 'bold': s['weight'] == 'bold',
                'italic': s['style'] == 'italic', 'colour': s['fill'], 'indent': s['firstLineIndent']
                if line is block['lines'][0] else 0}
            for run in line:
                if run.get('marks'):
                    bold, italic = s['weight'] == 'bold', s['style'] == 'italic'
                    for m in run['marks']:
                        bold = theme['marks'][m].get('weight', 'bold' if bold else 'regular') == 'bold'
                        italic = theme['marks'][m].get('style', 'italic' if italic else 'normal') == 'italic'
                    words[run['text']] = {'bold': bold, 'italic': italic}
    return tokens, words


def main() -> None:
    measured = {'editor': json.loads((OUT / 'css.json').read_text()),
                'pdf': from_pdf(OUT / 'typst.pdf'), 'word': from_pdf(OUT / 'word.pdf')}
    want_tokens, want_words = expectations()
    report: dict = {'tolerance_pt': TOLERANCE, 'editor_font_loaded': measured['editor']['fontLoaded'],
                    'lines': [], 'gaps': [], 'words': [], 'failures': []}

    by_target = {t: {l['token']: l for l in measured[t]['lines']} for t in TARGETS}
    order = list(want_tokens)
    origin = {t: by_target[t]['T1x']['y'] for t in TARGETS}
    left = {t: by_target[t]['T2x']['x'] for t in TARGETS}

    for tok in order:
        row = {'token': tok, 'style': want_tokens[tok]['style']}
        for t in TARGETS:
            m = by_target[t].get(tok)
            if m is None:
                report['failures'].append(f'{tok} missing in {t}')
                continue
            row[t] = {'y': round(m['y'] - origin[t], 2), 'x': round(m['x'] - left[t], 2),
                      'size': round(m['size'], 2), 'bold': m['bold'], 'italic': m['italic'],
                      'colour': hex_colour(m['colour'])}
            want = want_tokens[tok]
            for prop in ('size', 'bold', 'italic', 'colour'):
                got = row[t][prop]
                ok = abs(got - want[prop]) <= 0.05 if prop == 'size' else got == want[prop]
                if not ok:
                    report['failures'].append(f'{tok} {prop} in {t}: {got}, theme says {want[prop]}')
            if abs(row[t]['x'] - want['indent']) > TOLERANCE:
                report['failures'].append(f'{tok} indent in {t}: {row[t]["x"]}, theme says {want["indent"]}')
        ys = [row[t]['y'] for t in TARGETS if t in row]
        if max(ys) - min(ys) > TOLERANCE:
            report['failures'].append(f'{tok} baseline disagrees: ' +
                                      ', '.join(f'{t} {row[t]["y"]}' for t in TARGETS if t in row))
        report['lines'].append(row)

    for a, b in zip(order, order[1:]):
        report['gaps'].append({'from': a, 'to': b, **{
            t: round(by_target[t][b]['y'] - by_target[t][a]['y'], 2) for t in TARGETS}})

    for t in TARGETS:
        for w in measured[t]['words']:
            want = want_words[w['word']]
            got = {'bold': w['bold'], 'italic': w['italic']}
            report['words'].append({'target': t, 'word': w['word'], **got, 'theme': want})
            if got != want:
                report['failures'].append(f'{w["word"]} in {t}: {got}, theme says {want}')

    (OUT / 'report.json').write_text(json.dumps(report, indent=2))

    print(f"editor font loaded: {report['editor_font_loaded']}")
    print(f"{'token':6} {'style':8} " + ' '.join(f'{t + " y":>9} {t + " x":>8}' for t in TARGETS))
    for row in report['lines']:
        print(f"{row['token']:6} {row['style']:8} " + ' '.join(
            f"{row[t]['y']:>9} {row[t]['x']:>8}" if t in row else f"{'-':>9} {'-':>8}" for t in TARGETS))
    print('\ngaps between consecutive baselines (pt):')
    for g in report['gaps']:
        print(f"  {g['from']} -> {g['to']}: " + ', '.join(f"{t} {g[t]}" for t in TARGETS))
    print('\nwords:')
    for w in report['words']:
        print(f"  {w['target']:6} {w['word']:11} bold={w['bold']!s:5} italic={w['italic']!s:5} theme={w['theme']}")
    print(f"\n{len(report['failures'])} disagreement(s):")
    for f in report['failures']:
        print('  ' + f)


if __name__ == '__main__':
    main()
