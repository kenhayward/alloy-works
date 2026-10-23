import { SaxesParser } from 'saxes';

/** One element, named `prefix:local` by its namespace's prefix below, whatever the file called it. */
export type XmlNode = {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: (XmlNode | string)[];
};

/** The namespaces a Word package uses, transitional and strict, each by the prefix this reader names it. */
const PREFIXES: Readonly<Record<string, string>> = {
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'w',
  'http://purl.oclc.org/ooxml/wordprocessingml/main': 'w',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r',
  'http://purl.oclc.org/ooxml/officeDocument/relationships': 'r',
  'http://schemas.openxmlformats.org/package/2006/relationships': 'rel',
  'http://schemas.openxmlformats.org/package/2006/content-types': 'ct',
  'http://schemas.openxmlformats.org/officeDocument/2006/math': 'm',
  'http://purl.oclc.org/ooxml/officeDocument/math': 'm',
  'http://schemas.openxmlformats.org/markup-compatibility/2006': 'mc',
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing': 'wp',
  'http://schemas.openxmlformats.org/drawingml/2006/main': 'a',
  'http://schemas.openxmlformats.org/drawingml/2006/picture': 'pic',
  'http://schemas.microsoft.com/office/word/2010/wordml': 'w14',
  'http://schemas.microsoft.com/office/word/2012/wordml': 'w15',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape': 'wps',
  'urn:schemas-microsoft-com:vml': 'v',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://purl.org/dc/terms/': 'dcterms',
  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties': 'cp',
  'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties': 'ep',
  'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties': 'op',
  'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes': 'vt',
  'http://www.w3.org/XML/1998/namespace': 'xml',
};

const named = (uri: string, local: string) => `${PREFIXES[uri] ?? '?'}:${local}`;

/** Elements and depth one part may hold (IM-C): far past any document, short of what exhausts a worker. */
export const XML_CAPS = { nodes: 2_000_000, depth: 256 } as const;

export type XmlCaps = { readonly nodes: number; readonly depth: number };

export type XmlRefusal = 'doctype' | 'nodes' | 'depth' | 'malformed';

export type XmlRead =
  | { readonly ok: true; readonly root: XmlNode }
  | { readonly ok: false; readonly refusal: XmlRefusal; readonly failure: string };

class Refused extends Error {
  constructor(
    readonly refusal: XmlRefusal,
    message: string,
  ) {
    super(message);
  }
}

/** Fed to the parser this many characters at a time. */
const CHUNK = 64 * 1024;

/**
 * A part's XML as a tree, by `saxes` (IM-C): a document type refused outright, so no entity is ever
 * declared, expanded or fetched; elements and depth capped as they are met. Text is kept only inside
 * the elements `text` names, and what `skip` names is kept as an empty element, its insides counted
 * against the caps and dropped, for the caller to report.
 */
export function readXml(
  bytes: Uint8Array,
  options: { readonly text: (name: string) => boolean; readonly skip?: (name: string) => boolean },
  caps: XmlCaps = XML_CAPS,
): XmlRead {
  const parser = new SaxesParser({ xmlns: true, position: false });
  const stack: { node: XmlNode; keepText: boolean; skipped: boolean }[] = [];
  let root: XmlNode | undefined;
  let nodes = 0;

  parser.on('doctype', () => {
    throw new Refused('doctype', 'A document type is never read');
  });
  parser.on('error', (error) => {
    throw new Refused('malformed', error.message);
  });
  parser.on('opentag', (tag) => {
    nodes += 1;
    if (nodes > caps.nodes) throw new Refused('nodes', `More than ${caps.nodes} elements`);
    if (stack.length >= caps.depth) throw new Refused('depth', `Deeper than ${caps.depth}`);
    const parent = stack.at(-1);
    const name = named(tag.uri ?? '', tag.local ?? tag.name);
    if (parent?.skipped) {
      stack.push({ node: parent.node, keepText: false, skipped: true });
      return;
    }
    const attributes: Record<string, string> = {};
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.prefix === 'xmlns' || attribute.name === 'xmlns') continue;
      attributes[attribute.uri ? named(attribute.uri, attribute.local) : attribute.local] =
        attribute.value;
    }
    const node: XmlNode = { name, attributes, children: [] };
    if (parent) parent.node.children.push(node);
    else root = node;
    const skipped = options.skip?.(name) ?? false;
    stack.push({ node, keepText: !skipped && options.text(name), skipped });
  });
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.on('text', (text) => {
    const top = stack.at(-1);
    if (top?.keepText) top.node.children.push(text);
  });

  try {
    const text = new TextDecoder('utf-8').decode(bytes);
    for (let at = 0; at < text.length; at += CHUNK) parser.write(text.slice(at, at + CHUNK));
    parser.close();
  } catch (error) {
    if (error instanceof Refused)
      return { ok: false, refusal: error.refusal, failure: error.message };
    return {
      ok: false,
      refusal: 'malformed',
      failure: error instanceof Error ? error.message : String(error),
    };
  }
  if (!root) return { ok: false, refusal: 'malformed', failure: 'No element' };
  return { ok: true, root };
}
