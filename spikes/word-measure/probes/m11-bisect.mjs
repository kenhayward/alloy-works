// Bisect M11: one document per construct, to find which one Word cannot open.
import { docx, para, run, sect, NORMAL, COMPAT15 } from './common.mjs';
import { constructs } from './m11.mjs';
const OUTB = process.argv[2];
constructs.forEach(([label, x], k) => {
  docx(`${OUTB}/c${k + 1}-inline.docx`, {
    body: para(run(label + ': ') + `<m:oMath>${x}</m:oMath>`) + sect(),
    styles: NORMAL,
    settings: COMPAT15,
  });
  docx(`${OUTB}/c${k + 1}-display.docx`, {
    body: `<w:p><m:oMathPara><m:oMath>${x}</m:oMath></m:oMathPara></w:p>` + sect(),
    styles: NORMAL,
    settings: COMPAT15,
  });
});
