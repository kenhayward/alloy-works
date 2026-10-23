import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const heading = (level: number, text: string) =>
  `<w:p><w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr>${run(text)}</w:p>`;
const paragraph = (inner: string) => `<w:p>${inner}</w:p>`;

/**
 * An invented Word document for an import (the IM plan, IMe): a section, Methods, holding two
 * components, Sampling and Results; a tracked change by Grace, so the file carries a name; and a
 * cross-reference whose bookmark is not in the file, where `outside`, so one reference stands outside
 * the import and must be resolved before it is accepted.
 * `stamp` is in its text and its name, so no run's file is recognised as an earlier run's.
 */
export function pondSurvey(
  stamp: string,
  { outside = true } = {},
): { readonly name: string; readonly bytes: Buffer } {
  const body = [
    heading(1, 'Methods'),
    heading(2, 'Sampling'),
    paragraph(
      `${run('We netted each pond ')}<w:ins w:id="1" w:author="Grace" w:date="2026-01-02T00:00:00Z">${run('twice ')}</w:ins>${run(`at dawn, survey ${stamp}.`)}`,
    ),
    outside &&
      paragraph(
        `${run('The counts are in ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF _Ref9 \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('Table 9')}<w:r><w:fldChar w:fldCharType="end"/></w:r>${run('.')}`,
      ),
    heading(2, 'Results'),
    paragraph(run('Newts were found in three ponds.')),
  ]
    .filter((each) => each !== false)
    .join('');
  const bytes = zipSync({
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    ),
  });
  return { name: `Pond survey ${stamp}.docx`, bytes: Buffer.from(bytes) };
}
