// Shared bits for the probes. Probe kit only.
export * from '../docx.mjs';
export const COMPAT15 =
  '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>';
export const OUT = new URL('../out/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
export const pt = (v) => Math.round(v * 20); // points to twips

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Field switches are written with a slash (' /h') and turned into backslashes here, so no
// backslash has to survive being typed. BS is one backslash.
export const BS = String.fromCharCode(92);
export const sw = (code) => code.replace(/ \/([a-z#*@!])/gi, (_, c) => ' ' + BS + c);
/** A complex field: begin, instruction, separate, a prefilled result (runs XML or text), end. */
export const fld = (code, result = '', rpr = '') => {
  const rp = rpr ? `<w:rPr>${rpr}</w:rPr>` : '';
  const res = result.startsWith('<')
    ? result
    : result
      ? `<w:r>${rp}<w:t xml:space="preserve">${esc(result)}</w:t></w:r>`
      : '';
  return (
    `<w:r>${rp}<w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r>${rp}<w:instrText xml:space="preserve"> ${esc(sw(code))} </w:instrText></w:r>` +
    `<w:r>${rp}<w:fldChar w:fldCharType="separate"/></w:r>` +
    res +
    `<w:r>${rp}<w:fldChar w:fldCharType="end"/></w:r>`
  );
};
export const bm = (id, name, inner) =>
  `<w:bookmarkStart w:id="${id}" w:name="${name}"/>${inner}<w:bookmarkEnd w:id="${id}"/>`;
export const lvl = (ilvl, fmt, text, extra = '') =>
  `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/>${extra}<w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${432 + ilvl * 144}" w:hanging="${432 + ilvl * 144}"/></w:pPr></w:lvl>`;
