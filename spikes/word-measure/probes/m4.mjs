// M4 - cross-references as fields over hidden _Ref bookmarks.
// m4-right: every REF/PAGEREF prefilled with what the scheme would print; m4-wrong: prefilled wrong,
// so an update is proved by what it replaces. Target caption and heading stand on page 2.
import { docx, p, para, run, sect, NORMAL, COMPAT15, OUT, fld, bm } from './common.mjs';
import { H, numbering, HEADING_STYLES, CAPTION } from './headings.mjs';

const FIG = '_Ref000000001'; // the caption's label and number
const SEC = '_Ref000000002'; // the heading
const LONG = '_Ref' + '0'.repeat(41); // 45 characters
const HYPH = 'b-abcdefghijklmnopqrstuvwxyz-1';

const build = (wrong) => {
  const f = (right, bad) => (wrong ? bad : right);
  const refs = (where) =>
    p(`[${where}] number:`) +
    para(run('REF fig: ') + fld(`REF ${FIG} /h`, f('Figure 2.1', 'Figure 9.9'))) +
    para(
      run('REF fig p: ') +
        fld(`REF ${FIG} /p /h`, f(where === 'before' ? 'below' : 'above', 'nowhere')),
    ) +
    para(run('REF sec r: ') + fld(`REF ${SEC} /r /h`, f('2', '9'))) +
    para(run('REF sec text: ') + fld(`REF ${SEC} /h`, f('Method', 'Wrong title'))) +
    para(run('REF sec r p: ') + fld(`REF ${SEC} /r /p /h`, f('2 below', 'nothing'))) +
    para(run('PAGEREF fig empty: ') + fld(`PAGEREF ${FIG} /h`, '')) +
    para(run('PAGEREF fig q: ') + fld(`PAGEREF ${FIG} /h`, '?')) +
    para(
      run('REF fig p (de-DE run): ', '<w:lang w:val="de-DE"/>') +
        fld(`REF ${FIG} /p /h`, f('unten', 'nowhere'), '<w:lang w:val="de-DE"/>'),
    );
  return (
    refs('before') +
    H(1, 'Introduction') +
    p('Text on page one.') +
    p('same-page before: ').replace('</w:p>', '') +
    fld(`REF ${FIG} /p /h`, f('x', 'nowhere')) +
    '</w:p>' +
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
    para(bm(2, SEC, run('Method')), '<w:pStyle w:val="heading-1"/>') +
    para(run('same page, before target: ') + fld(`REF ${FIG} /p /h`, f('below', 'nowhere'))) +
    para(
      bm(
        1,
        FIG,
        run('Figure ') +
          fld('STYLEREF 1 /s', '2') +
          run('.') +
          fld('SEQ Figure /* ARABIC /s 1', '1'),
      ) + run(' Grace measures a thing'),
      '<w:pStyle w:val="caption"/>',
    ) +
    para(run('same page, after target: ') + fld(`REF ${FIG} /p /h`, f('above', 'nowhere'))) +
    para(bm(3, LONG, run('Long-named target'))) +
    para(bm(4, HYPH, run('Hyphen-named target'))) +
    para(run('REF long: ') + fld(`REF ${LONG} /h`, f('Long-named target', 'WRONG long'))) +
    para(run('REF hyphen: ') + fld(`REF ${HYPH} /h`, f('Hyphen-named target', 'WRONG hyphen'))) +
    para(
      run('HYPERLINK to hyphen: ') +
        `<w:hyperlink w:anchor="${HYPH}"><w:r><w:t>link</w:t></w:r></w:hyperlink>`,
    ) +
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
    refs('after') +
    sect()
  );
};
const styles = NORMAL + HEADING_STYLES + CAPTION;
docx(OUT + 'm4-right.docx', { body: build(false), styles, numbering, settings: COMPAT15 });
docx(OUT + 'm4-wrong.docx', { body: build(true), styles, numbering, settings: COMPAT15 });
