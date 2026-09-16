import { admissionLimits } from './limits.js';

/**
 * The one piece of markup inside the content model: an equation's MathML (CNT-043).
 *
 * Every other string in a document is text, rendered as text. MathML is rendered as markup - the
 * editor puts it into the page as native MathML - so it is the one place a script, an event handler
 * or a link can hide inside content that has otherwise been sanitised. This reads it, keeps what is
 * on an allowlist of MathML Core, and writes it back in one form.
 *
 * Deliberately not a general XML parser, and not lenient. It reads elements, quoted attributes, text,
 * the five XML entities and numeric references, and refuses everything else - comments, CDATA,
 * declarations, processing instructions, named entities, unquoted attributes, a tag left open - as
 * unreadable. An equation that cannot be read is removed and reported rather than guessed at, because
 * a lenient reader is where a parser differential lives: what this reads as text, a browser reads as
 * a tag.
 */
export const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';

const allowedElements = new Set([
  'annotation',
  'math',
  'merror',
  'mfrac',
  'mi',
  'mmultiscripts',
  'mn',
  'mo',
  'mover',
  'mpadded',
  'mphantom',
  'mprescripts',
  'mroot',
  'mrow',
  'ms',
  'mspace',
  'msqrt',
  'mstyle',
  'msub',
  'msubsup',
  'msup',
  'mtable',
  'mtd',
  'mtext',
  'mtr',
  'munder',
  'munderover',
  'none',
  'semantics',
]);

/** The elements whose content is text. Text anywhere else is not MathML. */
const tokenElements = new Set(['annotation', 'mi', 'mn', 'mo', 'ms', 'mtext']);

/**
 * No `href`, no `on*`, no `style`, `class` or `id`, and no `mathcolor`, `mathbackground` or
 * `mathsize` - an equation carries no colour or size any more than text does (CNT-065).
 */
const allowedAttributes = new Set([
  'accent',
  'accentunder',
  'alttext',
  'arg',
  'columnalign',
  'columnspan',
  'depth',
  'dir',
  'display',
  'displaystyle',
  'encoding',
  'fence',
  'form',
  'height',
  'intent',
  'largeop',
  'linethickness',
  'lspace',
  'mathvariant',
  'maxsize',
  'minsize',
  'movablelimits',
  'rowalign',
  'rowspan',
  'rspace',
  'scriptlevel',
  'separator',
  'stretchy',
  'symmetric',
  'voffset',
  'width',
]);

export type MathmlFinding = {
  readonly subject:
    'script' | 'eventHandler' | 'hyperlink' | 'mathElement' | 'mathAttribute' | 'mathText';
  readonly detail: string;
};

export type MathmlResult =
  | { readonly ok: true; readonly mathml: string; readonly findings: readonly MathmlFinding[] }
  | { readonly ok: false; readonly failure: string };

type MathElement = { name: string; attributes: [string, string][]; children: MathNode[] };
type MathNode = MathElement | string;

class Unreadable extends Error {}

const NAME = /[A-Za-z_][A-Za-z0-9._:-]*/y;
const NOT_AN_XML_CHARACTER = /[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/u;
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function sanitiseMathml(source: string): MathmlResult {
  try {
    if (NOT_AN_XML_CHARACTER.test(source)) {
      throw new Unreadable('it holds a character XML does not allow');
    }
    const root = parse(source);
    if (root.name !== 'math') throw new Unreadable(`its root is <${root.name}>, not <math>`);
    const findings: MathmlFinding[] = [];
    const cleaned = clean(root, findings);
    return { ok: true, mathml: serialise(cleaned, true), findings };
  } catch (error) {
    if (error instanceof Unreadable) return { ok: false, failure: error.message };
    throw error;
  }
}

function readName(source: string, at: number): string | undefined {
  NAME.lastIndex = at;
  return NAME.exec(source)?.[0];
}

function skipWhitespace(source: string, at: number): number {
  let index = at;
  while (index < source.length && ' \t\n\r'.includes(source[index]!)) index += 1;
  return index;
}

function decode(raw: string): string {
  let decoded = '';
  let index = 0;
  for (;;) {
    const amp = raw.indexOf('&', index);
    if (amp === -1) return decoded + raw.slice(index);
    const semicolon = raw.indexOf(';', amp);
    const entity = semicolon === -1 ? '' : raw.slice(amp + 1, semicolon);
    let character: string | undefined = ENTITIES[entity];
    const numeric = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(entity);
    if (numeric) {
      const codePoint = numeric[1] ? Number.parseInt(numeric[1], 16) : Number(numeric[2]);
      if (codePoint <= 0x10ffff) {
        character = String.fromCodePoint(codePoint);
        if (NOT_AN_XML_CHARACTER.test(character)) character = undefined;
      }
    }
    if (character === undefined) {
      throw new Unreadable(`it holds an entity XML does not define: &${entity.slice(0, 12)}`);
    }
    decoded += raw.slice(index, amp) + character;
    index = semicolon + 1;
  }
}

function parse(source: string): MathElement {
  const documentNode: MathElement = { name: '#document', attributes: [], children: [] };
  const open: MathElement[] = [documentNode];
  let index = 0;

  while (index < source.length) {
    const current = open[open.length - 1]!;
    const lt = source.indexOf('<', index);
    const textEnd = lt === -1 ? source.length : lt;
    if (textEnd > index) {
      current.children.push(decode(source.slice(index, textEnd)));
      index = textEnd;
      continue;
    }

    const next = source[index + 1];
    if (next === '!' || next === '?') {
      throw new Unreadable(
        'comments, CDATA, declarations and processing instructions are not read',
      );
    }

    if (next === '/') {
      const closing = readName(source, index + 2);
      const end = closing === undefined ? -1 : skipWhitespace(source, index + 2 + closing.length);
      if (closing === undefined || source[end] !== '>')
        throw new Unreadable('a closing tag is malformed');
      const element = open.pop();
      if (element === undefined || element === documentNode || element.name !== closing) {
        throw new Unreadable(`</${closing}> closes an element that is not open`);
      }
      index = end + 1;
      continue;
    }

    const opening = readName(source, index + 1);
    if (opening === undefined) throw new Unreadable('a < starts no element');
    const element: MathElement = { name: opening, attributes: [], children: [] };
    const seen = new Set<string>();
    let at = index + 1 + opening.length;
    let selfClosing = false;

    for (;;) {
      const afterSpace = skipWhitespace(source, at);
      if (source.startsWith('/>', afterSpace)) {
        selfClosing = true;
        at = afterSpace + 2;
        break;
      }
      if (source[afterSpace] === '>') {
        at = afterSpace + 1;
        break;
      }
      const attribute = readName(source, afterSpace);
      if (afterSpace === at || attribute === undefined) {
        throw new Unreadable(`<${opening}> has a malformed attribute`);
      }
      const equals = skipWhitespace(source, afterSpace + attribute.length);
      const quoteAt = skipWhitespace(source, equals + 1);
      const quote = source[quoteAt];
      if (source[equals] !== '=' || (quote !== '"' && quote !== "'")) {
        throw new Unreadable(`<${opening}> has an attribute whose value is not quoted`);
      }
      const close = source.indexOf(quote, quoteAt + 1);
      if (close === -1) throw new Unreadable(`<${opening}> has an attribute value left open`);
      const raw = source.slice(quoteAt + 1, close);
      if (raw.includes('<')) throw new Unreadable(`<${opening}> has an attribute value holding <`);
      if (seen.has(attribute)) throw new Unreadable(`<${opening}> repeats an attribute`);
      seen.add(attribute);
      element.attributes.push([attribute, decode(raw)]);
      at = close + 1;
    }

    current.children.push(element);
    if (!selfClosing) {
      open.push(element);
      if (open.length - 1 > admissionLimits.mathDepth) {
        throw new Unreadable(`it is nested more than ${admissionLimits.mathDepth} deep`);
      }
    }
    index = at;
  }

  if (open.length > 1) throw new Unreadable(`<${open[open.length - 1]!.name}> is never closed`);
  const elements = documentNode.children.filter((child) => typeof child !== 'string');
  const strayText = documentNode.children.some(
    (child) => typeof child === 'string' && child.trim() !== '',
  );
  if (elements.length !== 1 || strayText) {
    throw new Unreadable('it does not have exactly one root element');
  }
  return elements[0]!;
}

function clean(element: MathElement, findings: MathmlFinding[]): MathElement {
  const attributes: [string, string][] = [];
  for (const [attribute, value] of element.attributes) {
    if (attribute === 'xmlns') {
      if (value !== MATHML_NAMESPACE) throw new Unreadable(`<${element.name}> is not MathML`);
      continue;
    }
    if (allowedAttributes.has(attribute)) {
      attributes.push([attribute, value.normalize('NFC')]);
      continue;
    }
    const local = attribute.slice(attribute.indexOf(':') + 1).toLowerCase();
    if (local === 'href') findings.push({ subject: 'hyperlink', detail: value });
    else if (local.startsWith('on')) findings.push({ subject: 'eventHandler', detail: attribute });
    else findings.push({ subject: 'mathAttribute', detail: attribute });
  }
  attributes.sort(([a], [b]) => (a < b ? -1 : 1));

  const isToken = tokenElements.has(element.name);
  const children: MathNode[] = [];
  let text = '';
  for (const child of element.children) {
    if (typeof child === 'string') {
      if (isToken) text += child;
      else if (child.trim() !== '') findings.push({ subject: 'mathText', detail: child.trim() });
      continue;
    }
    const local = child.name.slice(child.name.indexOf(':') + 1).toLowerCase();
    if (isToken || child.name === 'math' || !allowedElements.has(child.name)) {
      findings.push({ subject: local === 'script' ? 'script' : 'mathElement', detail: child.name });
      continue;
    }
    children.push(clean(child, findings));
  }
  if (isToken) {
    const collapsed = text
      .replace(/[ \t\n\r]+/g, ' ')
      .trim()
      .normalize('NFC');
    if (collapsed !== '') children.push(collapsed);
  }
  return { name: element.name, attributes, children };
}

/**
 * One form: the namespace declared once, on the root; attributes in lexicographic order; no
 * whitespace between elements; an empty element self-closed.
 *
 * Every combining mark is written as a character reference. NFC is applied to text before it is
 * written, and normalise applies NFC again to every string in the document - including this one. A
 * combining mark written raw after a `>` composes with it under NFC (`>` and U+0338 compose to U+226F), and a
 * tag whose `>` has been eaten reads its text as attributes. As a reference it cannot compose.
 */
function serialise(element: MathElement, isRoot: boolean): string {
  const attributes = isRoot
    ? [['xmlns', MATHML_NAMESPACE] as const, ...element.attributes]
    : element.attributes;
  const start = `<${element.name}${attributes.map(([key, value]) => ` ${key}="${escape(value, true)}"`).join('')}`;
  if (element.children.length === 0) return `${start}/>`;
  const content = element.children
    .map((child) => (typeof child === 'string' ? escape(child, false) : serialise(child, false)))
    .join('');
  return `${start}>${content}</${element.name}>`;
}

function escape(value: string, inAttribute: boolean): string {
  return value.replace(/[&<>"\t\n\r]|\p{M}/gu, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    if (character === '"' && inAttribute) return '&quot;';
    if (character === '"') return character;
    if (!inAttribute && (character === '\t' || character === '\n' || character === '\r')) {
      return character;
    }
    return `&#x${character.codePointAt(0)!.toString(16).toUpperCase()};`;
  });
}
