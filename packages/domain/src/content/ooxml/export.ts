import { zipSync } from 'fflate';

import type { ContentDocument, InlineNode, TextNode } from '../document.js';
import type { OutlineSection } from '../outline.js';
import { escapeXml } from './xml.js';

/**
 * Writing the content model out as a `.docx`.
 *
 * This exists to exercise the OOXML mapping while the schema can still change cheaply - ADR-0005
 * commits to designing the schema against this mapping, and a mapping written after the fact is
 * where fidelity dies. It emits the constructs the fidelity bar depends on and nothing decorative.
 */

export interface ExportSource {
  readonly outline: readonly OutlineSection[];
  readonly components: readonly { readonly id: string; readonly content: ContentDocument }[];
  readonly threads: readonly {
    readonly id: string;
    readonly author: string;
    readonly initials: string;
    readonly body: string;
  }[];
}

const encoder = new TextEncoder();

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function run(text: string, style?: string): string {
  const props = style === undefined ? '' : `<w:rPr><w:rStyle w:val="${style}"/></w:rPr>`;
  return `<w:r>${props}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function deletedRun(text: string): string {
  return `<w:r><w:delText xml:space="preserve">${escapeXml(text)}</w:delText></w:r>`;
}

const isText = (node: InlineNode): node is TextNode => node.type === 'text';

const suggestionOf = (node: InlineNode) =>
  isText(node) ? node.marks.find((mark) => mark.type === 'suggestion') : undefined;

const threadOf = (node: InlineNode) =>
  isText(node) ? node.marks.find((mark) => mark.type === 'comment')?.threadId : undefined;

interface EmitContext {
  /** Word numbers footnotes itself; 0 and -1 are reserved for the separator marks. */
  nextFootnoteId: number;
  footnotes: { id: number; text: string }[];
  revisionId: number;
}

function emitParagraph(nodes: readonly InlineNode[], context: EmitContext): string {
  let xml = '';
  let openThread: string | undefined;
  let index = 0;

  const closeThread = (): void => {
    if (openThread === undefined) return;
    xml +=
      `<w:commentRangeEnd w:id="${escapeXml(openThread)}"/>` +
      `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>` +
      `<w:commentReference w:id="${escapeXml(openThread)}"/></w:r>`;
    openThread = undefined;
  };

  while (index < nodes.length) {
    const node = nodes[index]!;

    const thread = threadOf(node);
    if (thread !== openThread) {
      closeThread();
      if (thread !== undefined) {
        xml += `<w:commentRangeStart w:id="${escapeXml(thread)}"/>`;
        openThread = thread;
      }
    }

    if (node.type === 'footnote') {
      const id = context.nextFootnoteId;
      context.nextFootnoteId += 1;
      context.footnotes.push({
        id,
        text: node.content.map((each) => each.text).join(''),
      });
      xml +=
        `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>` +
        `<w:footnoteReference w:id="${id}"/></w:r>`;
      index += 1;
      continue;
    }

    if (node.type === 'crossReference') {
      // A field, not text: Word recalculates the number, which is the whole point of a reference.
      xml +=
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        `<w:r><w:instrText xml:space="preserve"> REF ${escapeXml(node.targetId)} \\w \\h </w:instrText></w:r>` +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        run('0') +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
      index += 1;
      continue;
    }

    const suggestion = suggestionOf(node);
    if (suggestion === undefined) {
      xml += run(node.text);
      index += 1;
      continue;
    }

    // Consecutive runs carrying the same suggestion are ONE revision in OOXML. Emitting them
    // separately would turn a single redline into several on the way back in.
    const group: TextNode[] = [];
    while (index < nodes.length) {
      const candidate = nodes[index]!;
      if (suggestionOf(candidate)?.id !== suggestion.id || !isText(candidate)) break;
      group.push(candidate);
      index += 1;
    }

    const attrs =
      `w:id="${context.revisionId}" w:author="${escapeXml(suggestion.author)}" ` +
      'w:date="2026-01-01T00:00:00Z"';
    context.revisionId += 1;

    xml +=
      suggestion.operation === 'insert'
        ? `<w:ins ${attrs}>${group.map((each) => run(each.text)).join('')}</w:ins>`
        : `<w:del ${attrs}>${group.map((each) => deletedRun(each.text)).join('')}</w:del>`;
  }

  closeThread();
  return `<w:p>${xml}</w:p>`;
}

function emitHeading(section: OutlineSection, bookmarkId: number): string {
  const start =
    section.bookmark === undefined
      ? ''
      : `<w:bookmarkStart w:id="${bookmarkId}" w:name="${escapeXml(section.bookmark)}"/>`;
  const end = section.bookmark === undefined ? '' : `<w:bookmarkEnd w:id="${bookmarkId}"/>`;
  return (
    `<w:p><w:pPr><w:pStyle w:val="Heading${section.level}"/></w:pPr>` +
    `${start}${run(section.title)}${end}</w:p>`
  );
}

export function exportDocx(source: ExportSource): Uint8Array {
  const context: EmitContext = { nextFootnoteId: 1, footnotes: [], revisionId: 1 };
  const byId = new Map(source.components.map((component) => [component.id, component]));
  const claimed = new Set<string>();

  let body = '';
  let bookmarkId = 1;

  for (const section of source.outline) {
    body += emitHeading(section, bookmarkId);
    bookmarkId += 1;
    for (const componentId of section.componentIds) {
      claimed.add(componentId);
      const component = byId.get(componentId);
      if (component === undefined) continue;
      for (const block of component.content.content) {
        if (block.type === 'paragraph') body += emitParagraph(block.content, context);
      }
    }
  }

  for (const component of source.components) {
    if (claimed.has(component.id)) continue;
    for (const block of component.content.content) {
      if (block.type === 'paragraph') body += emitParagraph(block.content, context);
    }
  }

  body +=
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';

  const separators =
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': encoder.encode(
      XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': encoder.encode(
      XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    ),
    'word/_rels/document.xml.rels': encoder.encode(
      XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>' +
        '</Relationships>',
    ),
    'word/document.xml': encoder.encode(
      XML_HEAD + `<w:document ${W_NS}><w:body>${body}</w:body></w:document>`,
    ),
    'word/styles.xml': encoder.encode(
      XML_HEAD +
        `<w:styles ${W_NS}>` +
        [1, 2, 3, 4, 5, 6]
          .map(
            (level) =>
              `<w:style w:type="paragraph" w:styleId="Heading${level}">` +
              `<w:name w:val="heading ${level}"/><w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
              '</w:style>',
          )
          .join('') +
        '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/></w:style>' +
        '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/></w:style>' +
        '</w:styles>',
    ),
    'word/footnotes.xml': encoder.encode(
      XML_HEAD +
        `<w:footnotes ${W_NS}>` +
        separators +
        context.footnotes
          .map(
            (footnote) =>
              `<w:footnote w:id="${footnote.id}"><w:p>${run(footnote.text)}</w:p></w:footnote>`,
          )
          .join('') +
        '</w:footnotes>',
    ),
    'word/comments.xml': encoder.encode(
      XML_HEAD +
        `<w:comments ${W_NS}>` +
        source.threads
          .map(
            (thread) =>
              `<w:comment w:id="${escapeXml(thread.id)}" w:author="${escapeXml(thread.author)}" ` +
              `w:initials="${escapeXml(thread.initials)}" w:date="2026-01-01T00:00:00Z">` +
              `<w:p>${run(thread.body)}</w:p></w:comment>`,
          )
          .join('') +
        '</w:comments>',
    ),
  };

  return zipSync(files, { level: 6 });
}
