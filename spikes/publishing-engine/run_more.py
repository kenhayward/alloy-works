"""Throwaway. Cases 5 to 9 for the two finalists, and the gates re-run in the recommended shape.

Three renderers:
  weasyprint  - XHTML + CSS, equations pre-rendered to SVG by MathJax
  typst       - Typst markup, as the gates ran it
  typst-data  - the recommended shape: doc.json read by one fixed template.typ

Everything lands in out/, as the gate harness does. Case 9's second machine (arm64) is driven from
the host, because a container cannot start another container.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import cases
import cases_more
import typst_data
from render import CASES, OUT, PDF, page_count

FONTS = {
    'LiberationSerif-Regular.ttf': '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf',
    'LiberationSerif-Bold.ttf': '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf',
    'NotoSans-Regular.ttf': '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    'NotoSans-Bold.ttf': '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
}
SECRET = 'SECRET-VALUE-42'


# ---------------------------------------------------------------------------------------------
# Building the inputs.
# ---------------------------------------------------------------------------------------------

def build() -> None:
    cases.build(CASES)
    cases_more.build(CASES)

    data_docs = {
        'case1': cases.case1_tagged(), 'case2': cases.case2_footnotes(),
        'case3': cases.case3_table(), 'case4': cases.case4_long(),
        'case5': cases_more.case5_maths(hostile=True), 'case6': cases_more.case6_furniture(),
        'case8': cases_more.case8_long(), 'case8-0.25': cases_more.case8_long(0.25),
        'case8-0.5': cases_more.case8_long(0.5),
    }
    for name, doc in data_docs.items():
        d = CASES / name / 'data'
        typst_data.emit(doc, d)
        cases.write_chart_png(d / 'chart.png')
    for n in (1, 2, 3, 4):
        typst_data.emit(cases.case4_long(edit=n), CASES / 'case4' / 'data', f'edited{n}.json')

    # A file in the compile root that content must never be able to reach.
    (CASES / 'case5' / 'data' / 'secret.txt').write_text(SECRET)
    hostile = CASES / 'hostile'
    hostile.mkdir(parents=True, exist_ok=True)
    (hostile / 'secret.txt').write_text(SECRET)
    # What an emitter that forgot to escape would produce: content text, straight into markup.
    (hostile / 'hostile.typ').write_text('unescaped: #read("secret.txt") end\n')

    for name in ('case7', 'case7-missing'):
        fonts = CASES / name / 'fonts'
        fonts.mkdir(parents=True, exist_ok=True)
        for f, src in FONTS.items():
            shutil.copy(src, fonts / f)


# ---------------------------------------------------------------------------------------------
# Rendering, with time and peak memory measured in a fresh process each time.
# ---------------------------------------------------------------------------------------------

def measured(cmd: list[str], cwd: Path | None = None, env: dict | None = None) -> dict:
    """Run cmd in a fresh Python wrapper whose only child is cmd, so ru_maxrss is cmd's alone."""
    wrapper = ('import json,resource,subprocess,sys,time;t=time.perf_counter();'
               'r=subprocess.run(sys.argv[1:],capture_output=True,text=True);'
               'print(json.dumps({"ms":round((time.perf_counter()-t)*1000),'
               '"rss_mb":round(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss/1024),'
               '"code":r.returncode,"stderr":r.stderr[-1500:]}))')
    proc = subprocess.run([sys.executable, '-c', wrapper, *cmd], capture_output=True, text=True,
                          cwd=cwd, env={**os.environ, **(env or {})})
    return json.loads(proc.stdout.strip().splitlines()[-1])


WEASY = ('import json,logging,resource,sys,time\n'
         'from weasyprint import HTML\n'
         'logs=[]\n'
         'class H(logging.Handler):\n'
         '    def emit(self,r): logs.append(r.levelname+": "+r.getMessage())\n'
         'logging.getLogger("weasyprint").addHandler(H())\n'
         'logging.getLogger("weasyprint").setLevel(logging.WARNING)\n'
         't=time.perf_counter()\n'
         'code=0\n'
         'try: HTML(filename=sys.argv[1]).write_pdf(sys.argv[2],pdf_variant="pdf/ua-1")\n'
         'except Exception as e: code=1; logs.append("EXCEPTION: "+repr(e))\n'
         'print(json.dumps({"ms":round((time.perf_counter()-t)*1000),'
         '"rss_mb":round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024),'
         '"code":code,"stderr":"\\n".join(logs)[-1500:]}))\n')


def weasyprint(src: Path, dest: Path, env: dict | None = None) -> dict:
    proc = subprocess.run([sys.executable, '-c', WEASY, str(src), str(dest)], capture_output=True,
                          text=True, env={**os.environ, **(env or {})})
    return json.loads(proc.stdout.strip().splitlines()[-1])


def typst(src: Path, dest: Path, *extra: str, env: dict | None = None) -> dict:
    return measured(['typst', 'compile', '--pdf-standard', 'ua-1', *extra, src.name, str(dest)],
                    cwd=src.parent, env=env)


def render_all(engine: str, case: str, dest_name: str | None = None, **kw) -> dict:
    d = CASES / case
    dest = PDF / f'{dest_name or case}-{engine}.pdf'
    if engine == 'weasyprint':
        r = weasyprint(d / 'case.html', dest, **kw)
    elif engine == 'typst':
        r = typst(d / 'case.typ', dest, **kw)
    else:
        r = typst(d / 'data' / 'template.typ', dest, **kw)
    r['pages'] = page_count(dest) if dest.exists() else None
    return r


def main() -> None:
    build()
    PDF.mkdir(parents=True, exist_ok=True)
    res: dict = {'render': {}, 'case7': {}, 'case8': {}, 'gates_data': {}}

    # Cases 5 and 6 with all three renderers.
    for case in ('case5', 'case6'):
        for engine in ('weasyprint', 'typst', 'typst-data'):
            res['render'][f'{case}-{engine}'] = render_all(engine, case)
            print(case, engine, {k: v for k, v in res['render'][f'{case}-{engine}'].items()
                                 if k != 'stderr'}, flush=True)

    # The hazard the data shape removes, demonstrated rather than asserted.
    res['hostile_markup'] = measured(['typst', 'compile', 'hostile.typ', str(PDF / 'hostile.pdf')],
                                     cwd=CASES / 'hostile')

    # Case 7: available faces, then a missing one; system fonts, then pinned fonts only.
    pinned = ('--ignore-system-fonts', '--ignore-embedded-fonts', '--font-path', 'fonts')
    for case in ('case7', 'case7-missing'):
        res['case7'][f'{case}-weasyprint'] = render_all('weasyprint', case)
        res['case7'][f'{case}-typst'] = render_all('typst', case)
        d = CASES / case
        dest = PDF / f'{case}-typst-pinned.pdf'
        res['case7'][f'{case}-typst-pinned'] = {**typst(d / 'case.typ', dest, *pinned),
                                               'pages': page_count(dest)}
        for k in (f'{case}-weasyprint', f'{case}-typst', f'{case}-typst-pinned'):
            print(k, res['case7'][k], flush=True)

    # Case 8 at three lengths, twice each; keep the faster run as the warm number.
    for scale in ('0.25', '0.5', '1'):
        case = 'case8' if scale == '1' else f'case8-{scale}'
        for engine in ('weasyprint', 'typst-data', 'typst'):
            runs = [render_all(engine, case) for _ in range(2)]
            best = min(runs, key=lambda r: r['ms'])
            res['case8'][f'{scale}-{engine}'] = best
            print('case8', scale, engine, {k: v for k, v in best.items() if k != 'stderr'},
                  flush=True)

    # The gates, re-run in the recommended shape.
    for case in ('case1', 'case2', 'case3'):
        res['gates_data'][case] = render_all('typst-data', case)
        print('gate', case, 'typst-data', res['gates_data'][case], flush=True)
    res['gates_data']['case4'] = case4_data()
    print('gate case4 typst-data', res['gates_data']['case4'], flush=True)

    (OUT / 'more.json').write_text(json.dumps(res, indent=2))


def case4_data() -> dict:
    """Gate 4 again, with the data shape: typst watch on the template, doc.json changing under it."""
    from render import _wait_for
    d = CASES / 'case4' / 'data'
    live = Path('/tmp/live-data')
    shutil.rmtree(live, ignore_errors=True)
    shutil.copytree(d, live)
    out = live / 'doc.pdf'
    watch = subprocess.Popen(['typst', 'watch', '--pages', '40', str(live / 'template.typ'),
                              str(out)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True)
    edits = []
    try:
        _wait_for(out, None, 180)
        for n in (1, 2, 3, 4):
            before = out.stat().st_mtime_ns
            t0 = time.perf_counter()
            shutil.copy(d / f'edited{n}.json', live / 'doc.json')
            _wait_for(out, before, 120)
            edits.append(round((time.perf_counter() - t0) * 1000))
    finally:
        watch.terminate()
        watch.communicate(timeout=10)
    full = [typst(d / 'template.typ', PDF / 'case4-typst-data.pdf')['ms'] for _ in range(2)]
    return {'pages': page_count(PDF / 'case4-typst-data.pdf'), 'full_ms': min(full),
            'edit_runs_ms': edits, 'edit_ms': sorted(edits)[len(edits) // 2]}


if __name__ == '__main__':
    main()
