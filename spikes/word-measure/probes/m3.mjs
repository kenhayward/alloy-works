// M3 - caption numbers as fields: "Figure {STYLEREF 1 \s}.{SEQ Figure \* ARABIC \s 1}", prefilled.
// m3-level, m3-name and m3-nos are prefilled with the scheme's values; m3-wrongfill with "Z" and "9"
// everywhere, so an update is proved by what it replaces.
import { docx, p, para, run, sect, NORMAL, COMPAT15, OUT, fld } from './common.mjs';
import { H, numbering, HEADING_STYLES, CAPTION } from './headings.mjs';

const build = (styleref, wrong = false) => {
  const cap = (kind, chap, n, text) =>
    para(
      run(kind + ' ') +
        fld(styleref, wrong ? 'Z' : chap) +
        run('.') +
        fld(`SEQ ${kind} /* ARABIC /s 1`, wrong ? '9' : String(n)) +
        run(' ' + text),
      '<w:pStyle w:val="caption"/>',
    );
  return (
    H(1, 'Preface by Ada', 2) +
    p('Front text.') +
    cap('Figure', 'i', 1, 'A front figure (prefilled i.1)') +
    H(1, 'Introduction') +
    p('Text.') +
    cap('Figure', '1', 1, 'First figure') +
    cap('Figure', '1', 2, 'Second figure') +
    cap('Table', '1', 1, 'First table') +
    H(2, 'Scope') +
    cap('Figure', '1', 3, 'Figure under a second-level heading (prefilled 1.3)') +
    H(1, 'Method') +
    cap('Figure', '2', 1, 'Third figure') +
    cap('Table', '2', 1, 'Second table') +
    H(1, 'Tables of values', 3) +
    cap('Figure', 'A', 1, 'Appendix figure') +
    cap('Table', 'A', 1, 'Appendix table') +
    H(2, 'First values', 3) +
    cap('Figure', 'A', 2, 'Appendix figure under A.1 (prefilled A.2)') +
    sect()
  );
};

const styles = NORMAL + HEADING_STYLES + CAPTION;
docx(OUT + 'm3-level.docx', {
  body: build('STYLEREF 1 /s'),
  styles,
  numbering,
  settings: COMPAT15,
});
docx(OUT + 'm3-name.docx', {
  body: build('STYLEREF "Heading 1" /s'),
  styles,
  numbering,
  settings: COMPAT15,
});
docx(OUT + 'm3-nos.docx', { body: build('STYLEREF 1'), styles, numbering, settings: COMPAT15 });
docx(OUT + 'm3-wrongfill.docx', {
  body: build('STYLEREF 1 /s', true),
  styles,
  numbering,
  settings: COMPAT15,
});
