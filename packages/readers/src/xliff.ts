import type { XliffPart } from '@alloy-works/domain';
import { readXml, type XmlCaps, type XmlNode, XML_CAPS } from './docx/xml.js';

/**
 * **A returned XLIFF file read** (docs/design/translation.md, "Translation jobs"; the XL plan, XL-F):
 * an XLIFF 2 file, UTF-8 or UTF-16, by `readXml`'s guard - no document type, no entity, elements and
 * depth capped. Each file's units by id, each unit's target as the mapping's parts: its segments'
 * and ignorables' targets joined, so a tool that re-segmented it reads as it was sent; a paired code
 * `<pc>` as a pair, a `<cp>` as its character, an annotation `<mrk>` as its words. Nothing of a
 * `<source>` is read but an ignorable's with no target. What the parts say is checked against the
 * source by `xliffTarget`, never here.
 */

export type XliffReadRefusal = 'malformed' | 'unsafe' | 'not_xliff' | 'duplicate' | 'unsupported';

export type XliffRead =
  | {
      readonly ok: true;
      readonly source: string;
      readonly target: string | null;
      /** Each `<file>` by its id: each unit by its id, its target's parts, or null where it has none. */
      readonly files: ReadonlyMap<string, ReadonlyMap<string, readonly XliffPart[] | null>>;
    }
  | { readonly ok: false; readonly refusal: XliffReadRefusal; readonly failure: string };

/** The bytes as text by their byte order mark or first character, UTF-8 where neither says. */
function decoded(bytes: Uint8Array): Uint8Array {
  const [a, b] = [bytes[0], bytes[1]];
  const encoding =
    (a === 0xff && b === 0xfe) || (a === 0x3c && b === 0x00)
      ? 'utf-16le'
      : (a === 0xfe && b === 0xff) || (a === 0x00 && b === 0x3c)
        ? 'utf-16be'
        : undefined;
  if (encoding === undefined) return bytes;
  return new TextEncoder().encode(new TextDecoder(encoding).decode(bytes));
}

class Unsupported extends Error {}

const elements = (node: XmlNode) =>
  node.children.filter((child): child is XmlNode => typeof child !== 'string');

/** A target's or a source's insides as parts. */
function partsOf(node: XmlNode): XliffPart[] {
  const parts: XliffPart[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') {
      if (child !== '') parts.push({ kind: 'text', text: child });
      continue;
    }
    const id = child.attributes['id'] ?? '';
    switch (child.name) {
      case 'x:ph':
        parts.push({ kind: 'ph', id });
        break;
      case 'x:sc':
        parts.push({ kind: 'sc', id });
        break;
      case 'x:ec':
        parts.push({ kind: 'ec', startRef: child.attributes['startRef'] ?? id });
        break;
      case 'x:pc':
        parts.push({ kind: 'sc', id }, ...partsOf(child), { kind: 'ec', startRef: id });
        break;
      case 'x:mrk':
        parts.push(...partsOf(child));
        break;
      case 'x:sm':
      case 'x:em':
        break;
      case 'x:cp': {
        const code = Number.parseInt(child.attributes['hex'] ?? '', 16);
        if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
          throw new Unsupported('A code point that is none');
        }
        parts.push({ kind: 'text', text: String.fromCodePoint(code) });
        break;
      }
      default:
        throw new Unsupported(`An inline element this reader does not take: ${child.name}`);
    }
  }
  return parts;
}

/** A unit's target: each segment's and ignorable's in order, or null where a segment has none. */
function targetOf(unit: XmlNode): XliffPart[] | null {
  const parts: XliffPart[] = [];
  for (const piece of elements(unit)) {
    if (piece.name !== 'x:segment' && piece.name !== 'x:ignorable') continue;
    const target = elements(piece).find((each) => each.name === 'x:target');
    if (target) parts.push(...partsOf(target));
    else if (piece.name === 'x:ignorable') {
      const source = elements(piece).find((each) => each.name === 'x:source');
      if (source) parts.push(...partsOf(source));
    } else return null;
  }
  return parts;
}

/** Every unit under a file or a group, in order. */
function unitsUnder(node: XmlNode): XmlNode[] {
  return elements(node).flatMap((child) =>
    child.name === 'x:unit' ? [child] : child.name === 'x:group' ? unitsUnder(child) : [],
  );
}

/** Text inside a source or a target, and the inline elements within them, is kept; nothing else. */
const TEXT = new Set(['x:source', 'x:target', 'x:pc', 'x:mrk']);

export function readXliff(bytes: Uint8Array, caps: XmlCaps = XML_CAPS): XliffRead {
  const read = readXml(decoded(bytes), { text: (name) => TEXT.has(name) }, caps);
  if (!read.ok) {
    return {
      ok: false,
      refusal: read.refusal === 'malformed' ? 'malformed' : 'unsafe',
      failure: read.failure,
    };
  }
  const root = read.root;
  const version = root.attributes['version'] ?? '';
  if (root.name !== 'x:xliff' || !/^2\.\d+$/.test(version)) {
    return { ok: false, refusal: 'not_xliff', failure: 'Not an XLIFF 2 file' };
  }
  const files = new Map<string, Map<string, XliffPart[] | null>>();
  try {
    for (const file of elements(root).filter((each) => each.name === 'x:file')) {
      const id = file.attributes['id'] ?? '';
      if (files.has(id)) return { ok: false, refusal: 'duplicate', failure: `File ${id} twice` };
      const units = new Map<string, XliffPart[] | null>();
      for (const unit of unitsUnder(file)) {
        const unitId = unit.attributes['id'] ?? '';
        if (units.has(unitId)) {
          return { ok: false, refusal: 'duplicate', failure: `Unit ${unitId} twice` };
        }
        units.set(unitId, targetOf(unit));
      }
      files.set(id, units);
    }
  } catch (error) {
    if (error instanceof Unsupported) {
      return { ok: false, refusal: 'unsupported', failure: error.message };
    }
    throw error;
  }
  return {
    ok: true,
    source: root.attributes['srcLang'] ?? '',
    target: root.attributes['trgLang'] ?? null,
    files,
  };
}
