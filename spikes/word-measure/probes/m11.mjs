// M11 - equations (OMML): every construct the maths tree has, inline and in m:oMathPara, a numbered
// display equation with SEQ Equation at a right tab, and one too wide for the line.
// Maths font Cambria Math (installed); no run names a font. Characters are built from code points.
import { docx, p, para, run, sect, NORMAL, COMPAT15, OUT, fld } from './common.mjs';

const U = (...cps) => String.fromCodePoint(...cps);
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// m:r with optional m:sty (p, b, i, bi) or m:scr (roman, script, fraktur, double-struck, sans-serif, monospace)
const r = (t, { sty, scr } = {}) =>
  `<m:r>${sty || scr ? `<m:rPr>${scr ? `<m:scr m:val="${scr}"/>` : ''}${sty ? `<m:sty m:val="${sty}"/>` : ''}</m:rPr>` : ''}<m:t xml:space="preserve">${esc(t)}</m:t></m:r>`;
const e = (x) => `<m:e>${x}</m:e>`;
const f = (n, dd, noBar) =>
  `<m:f>${noBar ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''}<m:num>${n}</m:num><m:den>${dd}</m:den></m:f>`;
const nary = (chr, sub, sup, body, loc = 'undOvr') =>
  `<m:nary><m:naryPr><m:chr m:val="${chr}"/><m:limLoc m:val="${loc}"/></m:naryPr><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup>${e(body)}</m:nary>`;
const sSub = (b, s) => `<m:sSub>${e(b)}<m:sub>${s}</m:sub></m:sSub>`;
const sSup = (b, s) => `<m:sSup>${e(b)}<m:sup>${s}</m:sup></m:sSup>`;
const sSubSup = (b, s, t) => `<m:sSubSup>${e(b)}<m:sub>${s}</m:sub><m:sup>${t}</m:sup></m:sSubSup>`;
const sPre = (s, t, b) => `<m:sPre><m:sub>${s}</m:sub><m:sup>${t}</m:sup>${e(b)}</m:sPre>`;
const d = (beg, end, parts, sep) =>
  `<m:d><m:dPr><m:begChr m:val="${esc(beg)}"/>${sep ? `<m:sepChr m:val="${esc(sep)}"/>` : ''}<m:endChr m:val="${esc(end)}"/></m:dPr>${parts.map(e).join('')}</m:d>`;
const rad = (body, deg) =>
  `<m:rad>${deg ? '' : '<m:radPr><m:degHide m:val="1"/></m:radPr>'}<m:deg>${deg ?? ''}</m:deg>${e(body)}</m:rad>`;
const acc = (chr, body) => `<m:acc><m:accPr><m:chr m:val="${chr}"/></m:accPr>${e(body)}</m:acc>`;
const bar = (pos, body) => `<m:bar><m:barPr><m:pos m:val="${pos}"/></m:barPr>${e(body)}</m:bar>`;
const groupChr = (chr, pos, body) =>
  `<m:groupChr><m:groupChrPr><m:chr m:val="${chr}"/><m:pos m:val="${pos}"/><m:vertJc m:val="${pos === 'top' ? 'bot' : 'top'}"/></m:groupChrPr>${e(body)}</m:groupChr>`;
const limUpp = (body, lim) => `<m:limUpp>${e(body)}<m:lim>${lim}</m:lim></m:limUpp>`;
const limLow = (body, lim) => `<m:limLow>${e(body)}<m:lim>${lim}</m:lim></m:limLow>`;
const func = (name, arg) => `<m:func><m:fName>${name}</m:fName>${e(arg)}</m:func>`;
const mat = (rows) =>
  `<m:m>${rows.map((row) => `<m:mr>${row.map(e).join('')}</m:mr>`).join('')}</m:m>`;
const eqArr = (rows) => `<m:eqArr>${rows.map(e).join('')}</m:eqArr>`;
const phant = (body) => `<m:phant><m:phantPr><m:show m:val="0"/></m:phantPr>${e(body)}</m:phant>`;
const oMath = (x) => `<m:oMath>${x}</m:oMath>`;
const display = (x) => `<w:p><m:oMathPara>${oMath(x)}</m:oMathPara></w:p>`;

const X = r('x'),
  A = r('a'),
  B = r('b'),
  N = r('n'),
  I = r('i');
export const constructs = [
  [
    '1 identifiers: italic x, upright d, bold v, bold-italic w, bb R, cal L, frak g, sans s, mono m',
    X +
      r(' ') +
      r('d', { sty: 'p' }) +
      r(' ') +
      r('v', { sty: 'b' }) +
      r(' ') +
      r('w', { sty: 'bi' }) +
      r(' ') +
      r('R', { scr: 'double-struck', sty: 'p' }) +
      r(' ') +
      r('L', { scr: 'script', sty: 'p' }) +
      r(' ') +
      r('g', { scr: 'fraktur', sty: 'p' }) +
      r(' ') +
      r('s', { scr: 'sans-serif', sty: 'p' }) +
      r(' ') +
      r('m', { scr: 'monospace', sty: 'p' }),
  ],
  ['2 number and operators', r('2.5') + r('+') + X + r('=') + r('7')],
  ['3 sum with limits holding its operand', nary(U(0x2211), I + r('=') + r('1'), N, sSub(X, I))],
  [
    '4 integral with limits',
    nary(U(0x222b), r('0'), r('1'), r('f') + d('(', ')', [X]) + r('d', { sty: 'p' }) + X, 'subSup'),
  ],
  [
    '5 lim as func with limLow',
    func(
      limLow(r('lim', { sty: 'p' }), X + r(U(0x2192)) + r('0')),
      f(func(r('sin', { sty: 'p' }), X), X),
    ),
  ],
  ['6 fraction', f(A, B)],
  ['7 fraction without a bar', f(A, B, true)],
  ['8 binomial', d('(', ')', [f(N, r('k'), true)])],
  ['9 square root', rad(X + r('+') + r('1'))],
  ['10 root with degree', rad(X, r('3'))],
  ['11 scripts', sSubSup(X, I, r('2'))],
  ['12 prescripts', sPre(r('1'), r('2'), X)],
  ['13 accent (hat)', acc(U(0x0302), X)],
  [
    '14 overline and underline',
    bar('top', X + r('+') + r('y')) + r(' ') + bar('bot', X + r('+') + r('y')),
  ],
  ['15 overbrace with a label', limUpp(groupChr(U(0x23de), 'top', A + r('+') + B), N)],
  [
    '16 fence with an empty side',
    d('', '|', [f(r('d', { sty: 'p' }) + r('f'), r('d', { sty: 'p' }) + X)]),
  ],
  ['17 fences with a middle bar', d(U(0x27e8), U(0x27e9), [A, B], '|')],
  [
    '18 matrix in brackets',
    d('[', ']', [
      mat([
        [A, B],
        [r('c'), r('d')],
      ]),
    ]),
  ],
  [
    '19 cases',
    d('{', '', [
      eqArr([
        X + r(',  ') + X + r(U(0x2265)) + r('0'),
        r(U(0x2212)) + X + r(',  ') + X + r('<') + r('0'),
      ]),
    ]),
  ],
  [
    '20 aligned multi-line (eqArr with ampersands)',
    eqArr([r('y') + r('&=') + A + r('+') + B, r('&=') + r('c')]),
  ],
  ['21 phantom (hidden a+b, then c)', phant(A + r('+') + B) + r('c')],
  ['22 primes', r('f') + r(U(0x2032, 0x2032)) + d('(', ')', [X])],
  ['23 a space (em space between a and b)', A + r(U(0x2003)) + B],
];

const TABS =
  '<w:tabs><w:tab w:val="center" w:pos="4513"/><w:tab w:val="right" w:pos="9026"/></w:tabs>';
const numbered = (x, n) =>
  para(
    '<w:r><w:tab/></w:r>' +
      oMath(x) +
      '<w:r><w:tab/></w:r>' +
      run('(') +
      fld('SEQ Equation /* ARABIC', String(n)) +
      run(')'),
    TABS,
  );

let body = p('M11 equations - each construct inline, then as a display.');
for (const [label, x] of constructs) body += para(run(label + ': ') + oMath(x)) + display(x);
body +=
  p('24 numbered display equation:') + numbered(r('E') + r('=') + r('m') + sSup(r('c'), r('2')), 1);
const terms = Array.from(
  { length: 24 },
  (_, k) => sSub(r('a'), r(String(k + 1))) + sSup(X, r(String(k + 1))),
).join(r('+'));
body += p('25 too wide for the line (display):') + display(r('y') + r('=') + terms);
body += p('26 too wide, numbered at a right tab:') + numbered(r('y') + r('=') + terms, 2);
body += sect();

const mathPr =
  '<m:mathPr><m:mathFont m:val="Cambria Math"/><m:dispDef/><m:wrapIndent m:val="1440"/><m:intLim m:val="subSup"/><m:naryLim m:val="undOvr"/></m:mathPr>';
docx(OUT + 'm11-cambria.docx', { body, styles: NORMAL, settings: COMPAT15 + mathPr });
