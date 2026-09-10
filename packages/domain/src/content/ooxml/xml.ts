/**
 * A minimal XML scanner, enough for the OOXML parts this spike reads.
 *
 * Deliberately not a general XML parser. It assumes what OOXML actually emits: no CDATA, no raw
 * `>` inside an attribute value, no DTD. That is true of every part Word writes, and a real parser
 * is a dependency this spike does not need to justify. If the OOXML work becomes product code,
 * this is the first thing to replace.
 */

export interface XmlElementEvent {
  readonly kind: 'open' | 'self';
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
}

export interface XmlCloseEvent {
  readonly kind: 'close';
  readonly name: string;
}

export interface XmlTextEvent {
  readonly kind: 'text';
  readonly value: string;
}

export type XmlEvent = XmlElementEvent | XmlCloseEvent | XmlTextEvent;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9A-Fa-f]+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity] ?? whole;
  });
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ATTR = /([\w:.-]+)\s*=\s*"([^"]*)"/g;

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR.exec(source)) !== null) {
    attrs[match[1]!] = decodeEntities(match[2]!);
  }
  return attrs;
}

export function scanXml(xml: string): XmlEvent[] {
  const events: XmlEvent[] = [];
  let index = 0;

  while (index < xml.length) {
    const open = xml.indexOf('<', index);
    if (open === -1) {
      const trailing = xml.slice(index);
      if (trailing.length > 0) events.push({ kind: 'text', value: decodeEntities(trailing) });
      break;
    }

    if (open > index) {
      events.push({ kind: 'text', value: decodeEntities(xml.slice(index, open)) });
    }

    const close = xml.indexOf('>', open);
    if (close === -1) break;

    // Declarations, comments and processing instructions carry nothing this reader wants.
    if (xml[open + 1] === '?' || xml[open + 1] === '!') {
      index = close + 1;
      continue;
    }

    const raw = xml.slice(open + 1, close);
    if (raw.startsWith('/')) {
      events.push({ kind: 'close', name: raw.slice(1).trim() });
    } else {
      const selfClosing = raw.endsWith('/');
      const body = selfClosing ? raw.slice(0, -1) : raw;
      const name = /^[\w:.-]+/.exec(body)?.[0] ?? '';
      events.push({
        kind: selfClosing ? 'self' : 'open',
        name,
        attrs: parseAttrs(body.slice(name.length)),
      });
    }

    index = close + 1;
  }

  return events;
}
