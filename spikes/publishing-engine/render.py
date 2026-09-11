"""Throwaway. Renders every gate case with every candidate, and times case 4.

Every candidate is asked for its accessible output - WeasyPrint's PDF/UA-1 variant, Typst's PDF/UA-1
standard, Chromium's tagged export - because that is what the product would always produce, and
timing the untagged path would flatter whichever engine tags most expensively.

One control is rendered on purpose: WeasyPrint with tagging off. veraPDF must reject it. If it does
not, the oracle for gate 1 is not an oracle, and every other verdict is worthless.
"""

from __future__ import annotations

import json
import os
import shutil
import statistics
import subprocess
import sys
import time
from pathlib import Path

import pikepdf

HERE = Path(__file__).parent
OUT = HERE / 'out'
CASES = OUT / 'cases'
PDF = OUT / 'pdf'
ENGINES = ['weasyprint', 'pagedjs', 'chrome', 'typst']


def page_count(path: Path) -> int | None:
    try:
        with pikepdf.open(path) as pdf:
            return len(pdf.pages)
    except Exception:
        return None


def weasyprint_render(src: Path, dest: Path, variant: str | None = 'pdf/ua-1') -> dict:
    from weasyprint import HTML
    t0 = time.perf_counter()
    if variant:
        HTML(filename=str(src)).write_pdf(str(dest), pdf_variant=variant)
    else:
        HTML(filename=str(src)).write_pdf(str(dest))
    return {'total_ms': round((time.perf_counter() - t0) * 1000)}


def browser_render(mode: str, src: Path, dest: Path, *extra: str) -> dict:
    proc = subprocess.run(['node', str(HERE / 'browser.mjs'), mode, str(src), str(dest), *extra],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip()[-600:])
    return json.loads(proc.stdout.strip().splitlines()[-1])


def typst_render(src: Path, dest: Path, *extra: str, tagged: bool = True) -> dict:
    # Typst refuses a tagged export of a page range: '--pages implies --no-pdf-tags', because a
    # range severs the structure tree. So a page-range preview is untagged by necessity.
    standard = ['--pdf-standard', 'ua-1'] if tagged else []
    t0 = time.perf_counter()
    proc = subprocess.run(['typst', 'compile', *standard, *extra, str(src),
                           str(dest)], capture_output=True, text=True, cwd=src.parent)
    ms = round((time.perf_counter() - t0) * 1000)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip()[-1200:])
    return {'total_ms': ms, 'warnings': proc.stderr.strip()[-600:] or None}


def render(engine: str, case: str) -> dict:
    d = CASES / case
    dest = PDF / f'{case}-{engine}.pdf'
    try:
        if engine == 'weasyprint':
            timing = weasyprint_render(d / 'case.html', dest)
        elif engine in ('pagedjs', 'chrome'):
            timing = browser_render(engine, d / 'case.html', dest)['runs'][0]
        else:
            timing = typst_render(d / 'case.typ', dest)
        return {'ok': True, 'pages': page_count(dest), **timing}
    except Exception as exc:  # an engine refusing is a finding, not a crash
        return {'ok': False, 'error': str(exc)}


# ---------------------------------------------------------------------------------------------
# Case 4: the preview gate. Three numbers per engine, all with a warm process:
#   full      - the whole ~300-page document
#   page40    - the best mechanism the engine offers for producing page 40 alone
#   edit      - after one sentence is added near page 40, how long until page 40 is current again
# ---------------------------------------------------------------------------------------------

def median(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs)) if xs else None


def case4_weasyprint() -> dict:
    from weasyprint import HTML
    d = CASES / 'case4'

    def timed(src: Path, only40: bool) -> tuple[int, int]:
        t0 = time.perf_counter()
        doc = HTML(filename=str(src)).render(pdf_variant='pdf/ua-1')
        target = doc.copy([doc.pages[39]]) if only40 else doc
        target.write_pdf(str(PDF / 'case4-weasyprint.pdf' if not only40
                             else PDF / 'case4-weasyprint-p40.pdf'), pdf_variant='pdf/ua-1')
        return round((time.perf_counter() - t0) * 1000), len(doc.pages)

    timed(d / 'case.html', True)  # warm the process: imports, font discovery
    full = [timed(d / 'case.html', False) for _ in range(2)]
    p40 = [timed(d / 'case.html', True)[0] for _ in range(2)]
    edit = [timed(d / 'edited.html', True)[0] for _ in range(2)]
    return {'pages': full[0][1], 'full_ms': median([f[0] for f in full]),
            'page40_ms': median(p40), 'edit_ms': median(edit),
            'mechanism': 'full layout, then copy page 40; no incremental layout exists'}


def case4_browser(mode: str) -> dict:
    d = CASES / 'case4'
    full = browser_render(mode, d / 'case.html', PDF / f'case4-{mode}.pdf', '--repeat', '2')
    p40 = browser_render(mode, d / 'case.html', PDF / f'case4-{mode}-p40.pdf',
                         '--pages', '40', '--repeat', '2')
    edit = browser_render(mode, d / 'case.html', PDF / f'case4-{mode}-p40e.pdf',
                          '--pages', '40', '--repeat', '2', '--edited', str(d / 'edited.html'))
    warm = lambda r: r['runs'][-1]  # noqa: E731 - the second run, browser already up
    result = {'pages': page_count(PDF / f'case4-{mode}.pdf'),
              'full_ms': warm(full)['total_ms'],
              'page40_ms': warm(p40)['total_ms'],
              'edit_ms': warm(edit)['total_ms']}
    if mode == 'pagedjs':
        # PagedJS lays pages out one at a time in a live DOM, so a preview tab can show page 40
        # before the rest exist. That on-screen number is the one a writer would feel.
        # Loading the document is part of the cost: a preview reloads after every edit.
        onscreen = lambda r: r['load_ms'] + r['to_target_page_ms']  # noqa: E731
        result['page40_onscreen_ms'] = onscreen(warm(p40))
        result['edit_onscreen_ms'] = onscreen(warm(edit))
        result['mechanism'] = 'sequential layout in a live DOM; page 40 visible once laid out'
    else:
        result['mechanism'] = 'pageRanges on print; the whole document is still laid out'
    return result


def case4_typst() -> dict:
    d = CASES / 'case4'
    full = [typst_render(d / 'case.typ', PDF / 'case4-typst.pdf')['total_ms'] for _ in range(2)]
    p40 = [typst_render(d / 'case.typ', PDF / 'case4-typst-p40.pdf', '--pages', '40',
                        tagged=False)['total_ms'] for _ in range(2)]

    # typst watch keeps its memoised layout between compiles. That is the whole question, so it
    # is measured the way it would be used: a long-running process, a file changing under it.
    # Runs in /tmp because inotify does not cross a Docker Desktop bind mount reliably.
    live = Path('/tmp/live')
    shutil.rmtree(live, ignore_errors=True)
    live.mkdir()
    shutil.copy(d / 'chart.png', live / 'chart.png')
    shutil.copy(d / 'case.typ', live / 'doc.typ')
    out = live / 'doc.pdf'
    watch = subprocess.Popen(['typst', 'watch', '--pages', '40', str(live / 'doc.typ'), str(out)],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    edits = []
    try:
        _wait_for(out, None, 120)
        # Four different edits in turn: each is new to the cache, which is what typing is.
        texts = [(d / f'edited{n}.typ').read_text() for n in (1, 2, 3, 4)]
        for text in texts:
            before = out.stat().st_mtime_ns
            t0 = time.perf_counter()
            (live / 'doc.typ').write_text(text)
            _wait_for(out, before, 60)
            edits.append(round((time.perf_counter() - t0) * 1000))
    finally:
        watch.terminate()
        log = watch.communicate(timeout=10)[0]
    return {'pages': page_count(PDF / 'case4-typst.pdf'), 'full_ms': median(full),
            'page40_ms': median(p40), 'edit_ms': median(edits), 'edit_runs_ms': edits,
            'edit_note': 'every edit is novel content; none can be answered from the cache',
            'mechanism': 'typst watch: memoised layout reused across compiles',
            'note': 'page-range export is untagged by necessity; the full export is PDF/UA-1',
            'watch_log_tail': log.strip().splitlines()[-4:]}


def _wait_for(path: Path, before_ns: int | None, timeout_s: float) -> None:
    deadline = time.perf_counter() + timeout_s
    while time.perf_counter() < deadline:
        if path.exists() and (before_ns is None or path.stat().st_mtime_ns != before_ns):
            size = path.stat().st_size
            time.sleep(0.02)  # let the write finish
            if path.stat().st_size == size and size > 0:
                return
        time.sleep(0.005)
    raise TimeoutError(f'{path} did not update within {timeout_s}s')


def main() -> None:
    import cases
    PDF.mkdir(parents=True, exist_ok=True)
    if '--case4' not in sys.argv:
        cases.build(CASES)
    results: dict = {'versions': versions(), 'render': {}, 'case4': {}}

    for case in ('case1', 'case2', 'case3'):
        for engine in ENGINES:
            results['render'][f'{case}-{engine}'] = render(engine, case)
            print(case, engine, results['render'][f'{case}-{engine}'], flush=True)

    results['render']['case1-weasyprint-untagged-control'] = {
        'ok': True, **weasyprint_render(CASES / 'case1' / 'case.html',
                                        PDF / 'case1-weasyprint-untagged-control.pdf', None)}

    only = sys.argv[sys.argv.index('--case4') + 1] if '--case4' in sys.argv else None
    if only:
        results = json.loads((OUT / 'render.json').read_text())
        fn = {'typst': case4_typst, 'weasyprint': case4_weasyprint,
              'chrome': lambda: case4_browser('chrome'),
              'pagedjs': lambda: case4_browser('pagedjs')}[only]
        results['case4'][only] = fn()
        print('case4', only, results['case4'][only], flush=True)
        (OUT / 'render.json').write_text(json.dumps(results, indent=2))
        return

    if '--skip-case4' not in sys.argv:
        for engine, fn in [('typst', case4_typst), ('chrome', lambda: case4_browser('chrome')),
                           ('pagedjs', lambda: case4_browser('pagedjs')),
                           ('weasyprint', case4_weasyprint)]:
            try:
                results['case4'][engine] = fn()
            except Exception as exc:
                results['case4'][engine] = {'error': str(exc)[-800:]}
            print('case4', engine, results['case4'][engine], flush=True)

    (OUT / 'render.json').write_text(json.dumps(results, indent=2))


def versions() -> dict:
    def run(*cmd):
        return subprocess.run(cmd, capture_output=True, text=True).stdout.strip().splitlines()[0]
    import weasyprint
    return {'weasyprint': weasyprint.__version__, 'typst': run('typst', '--version'),
            'chromium': run('chromium', '--version'),
            'pagedjs': json.loads((Path(os.environ['NODE_PATH']) / 'pagedjs' /
                                   'package.json').read_text())['version'],
            'cpus': os.cpu_count()}


if __name__ == '__main__':
    main()
