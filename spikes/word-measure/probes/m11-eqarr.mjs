// M11 follow-up: which inline m:eqArr Word cannot open.
import { docx, para, run, sect, NORMAL, COMPAT15 } from './common.mjs';
const O = process.argv[2];
const r = (t) => `<m:r><m:t xml:space="preserve">${t}</m:t></m:r>`;
const arr = (amp) =>
  `<m:eqArr><m:e>${r('y') + r(amp ? '&amp;=' : '=') + r('a')}</m:e><m:e>${r(amp ? '&amp;=' : '=') + r('c')}</m:e></m:eqArr>`;
const v = {
  'e1-inline-amp-text': para(run('t: ') + `<m:oMath>${arr(true)}</m:oMath>`),
  'e2-inline-noamp-text': para(run('t: ') + `<m:oMath>${arr(false)}</m:oMath>`),
  'e3-inline-amp-alone': para(`<m:oMath>${arr(true)}</m:oMath>`),
  'e4-inline-amp-in-fence': para(
    run('t: ') +
      `<m:oMath><m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/></m:dPr><m:e>${arr(true)}</m:e></m:d></m:oMath>`,
  ),
  'e5-inline-amp-after-x': para(run('t: ') + `<m:oMath>${r('x')}${arr(true)}</m:oMath>`),
};
for (const [k, b] of Object.entries(v))
  docx(`${O}/${k}.docx`, { body: b + sect(), styles: NORMAL, settings: COMPAT15 });
