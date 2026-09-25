// M15 - complex-script size: M12's Hebrew paragraph again, (a) as M12 (w:sz 22 only), (b) w:szCs 22
// beside w:sz in docDefaults, (c) w:szCs 22 only in the Normal paragraph style (docDefaults w:sz only).
import { docx, para, run, sect, NORMAL, COMPAT15, OUT } from './common.mjs';

const U = (...cps) => String.fromCodePoint(...cps);
const SHALOM = U(0x05e9, 0x05dc, 0x05d5, 0x05dd),
  OLAM = U(0x05e2, 0x05d5, 0x05dc, 0x05dd),
  SEFER = U(0x05e1, 0x05e4, 0x05e8);
const HE = '<w:rtl/><w:lang w:bidi="he-IL"/>';
const body =
  para(run('Ada writes in English.')) +
  para(
    run(`${SHALOM} ${OLAM} `, HE) +
      run('Ada', '<w:lang w:bidi="he-IL"/>') +
      run(` ${SEFER} `, HE) +
      run('2026', HE) +
      run('.', HE),
    '<w:bidi/>',
  ) +
  sect();
const withDefaults = NORMAL.replace('<w:sz w:val="22"/>', '<w:sz w:val="22"/><w:szCs w:val="22"/>');
const withStyle = NORMAL.replace(
  '<w:name w:val="Normal"/></w:style>',
  '<w:name w:val="Normal"/><w:rPr><w:szCs w:val="22"/></w:rPr></w:style>',
);
if (withDefaults === NORMAL || withStyle === NORMAL) throw new Error('replacement failed');
docx(OUT + 'm15-a-sz-only.docx', { body, styles: NORMAL, settings: COMPAT15 });
docx(OUT + 'm15-b-szcs-defaults.docx', { body, styles: withDefaults, settings: COMPAT15 });
docx(OUT + 'm15-c-szcs-style.docx', { body, styles: withStyle, settings: COMPAT15 });
