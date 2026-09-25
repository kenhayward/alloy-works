// M5 - real footnotes: three in text and one in a table cell in section 1; in section 2 an automatic
// one, a customMarkFollows one ("*"), another automatic one, and one whose custom mark is "7".
// m5-restart: w:footnotePr numRestart eachSect in both sectPr; m5-continuous: none.
import { docx, para, run, NORMAL, COMPAT15, OUT } from './common.mjs';

const REFSTYLE = '<w:rStyle w:val="FootnoteReference"/>';
const styles =
  NORMAL +
  `<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="18"/></w:rPr></w:style>` +
  `<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>`;

const notes = [];
const fn = (text, custom) => {
  const id = notes.length + 1;
  const mark = custom
    ? `<w:r><w:rPr>${REFSTYLE}</w:rPr><w:t>${custom}</w:t></w:r>`
    : `<w:r><w:rPr>${REFSTYLE}</w:rPr><w:footnoteRef/></w:r>`;
  notes.push(
    `<w:footnote w:id="${id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>${mark}${run(' ' + text)}</w:p></w:footnote>`,
  );
  return custom
    ? `<w:r><w:rPr>${REFSTYLE}</w:rPr><w:footnoteReference w:customMarkFollows="1" w:id="${id}"/><w:t>${custom}</w:t></w:r>`
    : `<w:r><w:rPr>${REFSTYLE}</w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
};
const cell = (content) =>
  `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
const table = (content) =>
  `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr>${content}</w:tr></w:tbl>`;

const secPr = (restart, next) =>
  `<w:sectPr>${restart ? '<w:footnotePr><w:numRestart w:val="eachSect"/></w:footnotePr>' : ''}${next ? '<w:type w:val="nextPage"/>' : ''}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;

const build = (restart) => {
  notes.length = 0;
  const body =
    para(
      run('Ada writes a first claim.') +
        fn('First note, section one.') +
        run(' And a second.') +
        fn('Second note, section one.'),
    ) +
    table(
      cell(para(run('A cell holds a claim.') + fn('Note in a table cell.'))) +
        cell(para(run('Plain cell.'))),
    ) +
    para(run('A third claim after the table.') + fn('Third note in text, after the cell note.')) +
    `<w:p><w:pPr>${secPr(restart, false)}</w:pPr>${run('End of section one.')}</w:p>` +
    para(
      run('Grace opens section two.') +
        fn('Automatic note in section two.') +
        run(' Custom star.') +
        fn('Custom-marked note.', '*') +
        run(' Automatic again.') +
        fn('Automatic note after the custom one.') +
        run(' Custom seven.') +
        fn('Note whose custom mark is 7.', '7'),
    ) +
    secPr(restart, true);
  const footnotes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    notes.join('');
  return {
    body,
    footnotes,
    styles,
    settings:
      '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' + COMPAT15,
  };
};
docx(OUT + 'm5-restart.docx', build(true));
docx(OUT + 'm5-continuous.docx', build(false));
