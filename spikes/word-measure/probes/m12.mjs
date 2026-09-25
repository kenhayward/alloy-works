// M12 - language and direction: document default en-GB, a run in de-DE, a Hebrew paragraph
// (w:bidi, w:rtl, w:lang w:bidi="he-IL") holding a Latin word and a number, and a Hebrew paragraph
// without w:bidi (right-to-left runs in a left-to-right paragraph).
import { docx, p, para, run, sect, NORMAL, COMPAT15, OUT } from './common.mjs';

const U = (...cps) => String.fromCodePoint(...cps);
// Invented Hebrew words: "shalom" and "olam" (hello, world), "sefer" (book).
const SHALOM = U(0x05e9, 0x05dc, 0x05d5, 0x05dd);
const OLAM = U(0x05e2, 0x05d5, 0x05dc, 0x05dd);
const SEFER = U(0x05e1, 0x05e4, 0x05e8);
const HE = '<w:rtl/><w:lang w:bidi="he-IL"/>';

const body =
  para(
    run('Ada writes in British English, then ') +
      run('Grüße aus Berlin', '<w:lang w:val="de-DE"/>') +
      run(' and back.'),
  ) +
  para(
    run(`${SHALOM} ${OLAM} `, HE) +
      run('Ada', '<w:lang w:bidi="he-IL"/>') +
      run(` ${SEFER} `, HE) +
      run('2026', HE) +
      run('.', HE),
    '<w:bidi/>',
  ) +
  para(
    run(`${SHALOM} ${OLAM} `, HE) + run('Ada', '<w:lang w:bidi="he-IL"/>') + run(` ${SEFER}`, HE),
  ) +
  p('Back in English.') +
  sect();
docx(OUT + 'm12.docx', { body, styles: NORMAL, settings: COMPAT15 });
