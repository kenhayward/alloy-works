#!/bin/sh
# Throwaway. Runs inside the alloy-theme-conformance image, after emit.mjs has run on the host.
# Renders the fixture three ways and measures them.
set -e
cd /spike/out

python3 - <<'PY'
import re
import zipfile
from pathlib import Path

# The Word parts become a .docx - a zip with [Content_Types].xml first.
parts = Path('word/parts')
names = sorted((p for p in parts.rglob('*') if p.is_file()),
               key=lambda p: (p.name != '[Content_Types].xml', str(p)))
with zipfile.ZipFile('word.docx', 'w', zipfile.ZIP_DEFLATED) as z:
    for p in names:
        z.write(p, p.relative_to(parts).as_posix())

# The control: the same document with every pin removed and every character style kept. If the
# renderer implements Word's toggle rule, headword must come out NOT bold here; if it comes out
# bold anyway, the renderer cannot test the pin and Word itself has to.
pin = re.compile(rb'(<w:rStyle w:val="[^"]+"/>)(?:<w:[bi] w:val="[01]"/>)+')
src = zipfile.ZipFile('word.docx')
with zipfile.ZipFile('word-unpinned.docx', 'w', zipfile.ZIP_DEFLATED) as z:
    for item in src.infolist():
        data = src.read(item.filename)
        if item.filename == 'word/document.xml':
            data, removed = pin.subn(lambda m: m.group(1), data)
            print(f'control: {removed} pin(s) removed')
        z.writestr(item, data)
PY

(cd typst && typst compile template.typ ../typst.pdf)
for doc in word word-unpinned; do
  soffice --headless --convert-to pdf --outdir /spike/out "/spike/out/$doc.docx" > "/spike/out/$doc.log" 2>&1 \
    || { echo "LibreOffice failed on $doc:"; cat "/spike/out/$doc.log"; exit 1; }
  test -s "/spike/out/$doc.pdf" || { echo "LibreOffice wrote no $doc.pdf:"; cat "/spike/out/$doc.log"; exit 1; }
done
node /spike/measure_css.mjs /spike/out/editor.html > /spike/out/css.json
python3 /spike/measure.py
