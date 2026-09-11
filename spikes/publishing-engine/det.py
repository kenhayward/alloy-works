"""Throwaway. Case 9 - determinism (PUB-043).

  python3 det.py render <arch>   renders every input twice, with and without a fixed timestamp
  python3 det.py compare         compares runs on one machine, and across the two machines

The second machine is a different CPU architecture: publishing runs on servers, and the realistic
"other machine" is an ARM server beside an x86 one. That is also where floating-point layout
differences would show if there were any.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
CASES = HERE / 'out' / 'cases'
DET = HERE / 'out' / 'det'
FIXED = {'SOURCE_DATE_EPOCH': '1700000000'}

INPUTS = {
    'typst-case8': ('typst', CASES / 'case8' / 'data' / 'template.typ'),
    'typst-case5': ('typst', CASES / 'case5' / 'data' / 'template.typ'),
    'typst-case6': ('typst', CASES / 'case6' / 'data' / 'template.typ'),
    'weasyprint-case8': ('weasyprint', CASES / 'case8' / 'case.html'),
    'weasyprint-case5': ('weasyprint', CASES / 'case5' / 'case.html'),
    'weasyprint-case6': ('weasyprint', CASES / 'case6' / 'case.html'),
}


def render(arch: str) -> None:
    out = DET / arch
    out.mkdir(parents=True, exist_ok=True)
    for name, (engine, src) in INPUTS.items():
        for mode, extra_env in (('plain', {}), ('fixed', FIXED)):
            for run in (1, 2):
                dest = out / f'{name}-{mode}-{run}.pdf'
                env = {**os.environ, **extra_env}
                if engine == 'typst':
                    cmd = ['typst', 'compile', '--pdf-standard', 'ua-1', src.name, str(dest)]
                    subprocess.run(cmd, cwd=src.parent, env=env, check=True, capture_output=True)
                else:
                    code = ('import sys; from weasyprint import HTML; '
                            'HTML(filename=sys.argv[1]).write_pdf(sys.argv[2], pdf_variant="pdf/ua-1")')
                    subprocess.run([sys.executable, '-c', code, str(src), str(dest)], env=env,
                                   check=True, capture_output=True)
                print(arch, dest.name, flush=True)


# Fields a PDF is allowed to differ in: when it was made, and the identifiers minted for it.
DECLARED = re.compile(r'CreationDate|ModDate|/ID \[|xmp:(Create|Modify|Metadata)Date|'
                      r'xmpMM:(DocumentID|InstanceID)|uuid:', re.I)


def qdf_lines(path: Path) -> list[str]:
    out = path.with_suffix('.qdf')
    subprocess.run(['qpdf', '--qdf', '--object-streams=disable', '--decode-level=all',
                    str(path), str(out)], capture_output=True)
    return out.read_bytes().decode('latin-1').splitlines()


def rasters(path: Path) -> str:
    prefix = path.with_suffix('')
    subprocess.run(['pdftoppm', '-r', '36', '-png', str(path), str(prefix)], check=True)
    h = hashlib.sha256()
    for png in sorted(prefix.parent.glob(prefix.name + '-*.png')):
        h.update(png.read_bytes())
        png.unlink()
    return h.hexdigest()


def diff(a: Path, b: Path) -> dict:
    if a.read_bytes() == b.read_bytes():
        return {'identical': True}
    la, lb = qdf_lines(a), qdf_lines(b)
    import difflib
    changed = [l for l in difflib.unified_diff(la, lb, lineterm='', n=0)
               if l[:1] in '+-' and not l.startswith(('+++', '---'))]
    undeclared = [l for l in changed if not DECLARED.search(l)]
    return {'identical': False, 'changed_lines': len(changed), 'undeclared_lines': len(undeclared),
            'undeclared_sample': [l[:120] for l in undeclared[:4]],
            'pixels_identical': rasters(a) == rasters(b)}


def compare() -> None:
    report = {}
    for name in INPUTS:
        for mode in ('plain', 'fixed'):
            a1 = DET / 'amd64' / f'{name}-{mode}-1.pdf'
            a2 = DET / 'amd64' / f'{name}-{mode}-2.pdf'
            b1 = DET / 'arm64' / f'{name}-{mode}-1.pdf'
            report[f'{name} {mode}'] = {'same machine': diff(a1, a2),
                                        'across machines': diff(a1, b1) if b1.exists() else None}
    (HERE / 'out' / 'det.json').write_text(json.dumps(report, indent=2))
    for k, v in report.items():
        print(k, json.dumps(v))


if __name__ == '__main__':
    render(sys.argv[2]) if sys.argv[1] == 'render' else compare()
