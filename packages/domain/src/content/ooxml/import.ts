import { unzipSync } from 'fflate';

import type { BlockNode, InlineNode, Mark, TextNode } from '../document.js';
import { doc, paragraph } from '../document.js';
import type { OutlineSection } from '../outline.js';
import { scanXml } from './xml.js';
import type { XmlEvent } from './xml.js';

/**
 * Reading a `.docx` into the content model.
 *
 * Two rules shape this file, and both come from the scope rather than from OOXML:
 *
 *   1. **Nothing is dropped silently.** Anything the model cannot hold becomes a diagnostic. An
 *      unattended importer that quietly discards what it does not understand poisons a component
 *      repository, and a poisoned repository does not recover.
 *   2. **Headings go to the outline, not into content.** Word puts them inline; the model puts
 *      them in the outline, because a component reused at two depths cannot carry its own heading
 *      level. So importing SPLITS a document into an outline plus components.
 */

export interface ImportedSuggestion {
  readonly id: string;
  readonly operation: 'insert' | 'delete';
  readonly author: string;
  readonly text: string;
}

export interface ImportedThread {
  readonly id: string;
  readonly author: string;
  readonly initials: string;
  readonly body: string;
}

export interface ImportedFootnote {
  readonly id: string;
  readonly text: string;
}

export interface ImportedCrossReference {
  readonly id: string;
  readonly targetId: string;
}

export interface ImportDiagnostic {
  readonly code: string;
  readonly detail: string;
}

export interface ImportedComponent {
  readonly id: string;
  readonly content: ReturnType<typeof doc>;
}

export interface ImportedDocx {
  readonly outline: OutlineSection[];
  readonly components: ImportedComponent[];
  readonly threads: ImportedThread[];
  readonly suggestions: ImportedSuggestion[];
  readonly footnotes: ImportedFootnote[];
  readonly crossReferences: ImportedCrossReference[];
  readonly diagnostics: ImportDiagnostic[];
  /** Every part the package contained, so a caller can see what was not looked at. */
  readonly parts: string[];
}

const decoder = new TextDecoder();

function part(files: Record<string, Uint8Array>, name: string): string | undefined {
  const bytes = files[name];
  return bytes === undefined ? undefined : decoder.decode(bytes);
}

/** Word's footnote store also holds the separator marks, which are furniture rather than content. */
function readFootnotes(xml: string | undefined): Map<string, string> {
  const found = new Map<string, string>();
  if (xml === undefined) return found;

  let current: string | undefined;
  let text = '';
  let capturing = false;

  for (const event of scanXml(xml)) {
    if (event.kind === 'open' && event.name === 'w:footnote') {
      current = event.attrs['w:type'] === undefined ? event.attrs['w:id'] : undefined;
      text = '';
    } else if (event.kind === 'close' && event.name === 'w:footnote') {
      if (current !== undefined) found.set(current, text);
      current = undefined;
    } else if (event.kind === 'open' && event.name === 'w:t') {
      capturing = true;
    } else if (event.kind === 'close' && event.name === 'w:t') {
      capturing = false;
    } else if (event.kind === 'text' && capturing && current !== undefined) {
      text += event.value;
    }
  }

  return found;
}

function readComments(xml: string | undefined): ImportedThread[] {
  const threads: ImportedThread[] = [];
  if (xml === undefined) return threads;

  let id: string | undefined;
  let author = '';
  let initials = '';
  let body = '';
  let capturing = false;

  for (const event of scanXml(xml)) {
    if (event.kind === 'open' && event.name === 'w:comment') {
      id = event.attrs['w:id'];
      author = event.attrs['w:author'] ?? '';
      initials = event.attrs['w:initials'] ?? '';
      body = '';
    } else if (event.kind === 'close' && event.name === 'w:comment') {
      if (id !== undefined) threads.push({ id, author, initials, body });
      id = undefined;
    } else if (event.kind === 'open' && event.name === 'w:t') {
      capturing = true;
    } else if (event.kind === 'close' && event.name === 'w:t') {
      capturing = false;
    } else if (event.kind === 'text' && capturing && id !== undefined) {
      body += event.value;
    }
  }

  return threads;
}

const REF_TARGET = /\bREF\s+(\S+)/;

interface WalkState {
  outline: OutlineSection[];
  components: ImportedComponent[];
  suggestions: ImportedSuggestion[];
  crossReferences: ImportedCrossReference[];
  diagnostics: ImportDiagnostic[];
  blocks: BlockNode[];
  emptyParagraphs: number;
}

export function importDocx(bytes: Uint8Array): ImportedDocx {
  const files = unzipSync(bytes);
  const parts = Object.keys(files).sort();

  const footnoteText = readFootnotes(part(files, 'word/footnotes.xml'));
  const threads = readComments(part(files, 'word/comments.xml'));
  const documentXml = part(files, 'word/document.xml') ?? '';

  const state: WalkState = {
    outline: [],
    components: [],
    suggestions: [],
    crossReferences: [],
    diagnostics: [],
    blocks: [],
    emptyParagraphs: 0,
  };

  const usedFootnotes = new Set<string>();

  // Per-paragraph
  let inline: InlineNode[] = [];
  let style: string | undefined;
  let bookmark: string | undefined;

  // Spanning
  let activeSuggestion: { id: string; operation: 'insert' | 'delete'; author: string } | undefined;
  let suggestionText = '';
  const openComments = new Set<string>();
  let capture: 'text' | 'instruction' | undefined;
  let field: 'none' | 'instruction' | 'result' = 'none';
  let instruction = '';

  const flushComponent = (): void => {
    if (state.blocks.length === 0) return;
    const owner = state.outline[state.outline.length - 1];
    const id = `${owner?.id ?? 'preamble'}-content`;
    state.components.push({ id, content: doc(state.blocks) });
    owner?.componentIds.push(id);
    state.blocks = [];
  };

  const marksHere = (): Mark[] => {
    const marks: Mark[] = [];
    if (activeSuggestion !== undefined) {
      marks.push({
        type: 'suggestion',
        id: activeSuggestion.id,
        operation: activeSuggestion.operation,
        author: activeSuggestion.author,
      });
    }
    for (const threadId of openComments) {
      marks.push({ type: 'comment', id: `c-${threadId}`, threadId });
    }
    return marks;
  };

  const events: XmlEvent[] = scanXml(documentXml);

  for (const event of events) {
    if (event.kind === 'text') {
      if (capture === 'instruction') instruction += event.value;
      else if (capture === 'text' && field !== 'result') {
        // Text inside a field's cached result is Word's rendering of the reference, not content.
        if (activeSuggestion !== undefined) suggestionText += event.value;
        inline.push({ type: 'text', text: event.value, marks: marksHere() } as TextNode);
      }
      continue;
    }

    const { name } = event;

    if (event.kind === 'open' || event.kind === 'self') {
      switch (name) {
        case 'w:p':
          inline = [];
          style = undefined;
          bookmark = undefined;
          break;
        case 'w:pStyle':
          style = event.attrs['w:val'];
          break;
        case 'w:ins':
        case 'w:del':
          activeSuggestion = {
            id: `w-${name === 'w:ins' ? 'insert' : 'delete'}-${event.attrs['w:id'] ?? '0'}`,
            operation: name === 'w:ins' ? 'insert' : 'delete',
            author: event.attrs['w:author'] ?? 'Unknown',
          };
          suggestionText = '';
          break;
        case 'w:commentRangeStart': {
          const id = event.attrs['w:id'];
          if (id !== undefined) openComments.add(id);
          break;
        }
        case 'w:commentRangeEnd': {
          const id = event.attrs['w:id'];
          if (id !== undefined) openComments.delete(id);
          break;
        }
        case 'w:bookmarkStart': {
          const value = event.attrs['w:name'];
          if (value !== undefined && !value.startsWith('_GoBack')) bookmark = value;
          break;
        }
        case 'w:footnoteReference': {
          const id = event.attrs['w:id'];
          if (id !== undefined && footnoteText.has(id)) {
            usedFootnotes.add(id);
            inline.push({
              type: 'footnote',
              id: `fn-${id}`,
              content: [{ type: 'text', text: footnoteText.get(id) ?? '', marks: [] }],
            });
          }
          break;
        }
        case 'w:fldChar': {
          const kind = event.attrs['w:fldCharType'];
          if (kind === 'begin') {
            field = 'instruction';
            instruction = '';
          } else if (kind === 'separate') {
            field = 'result';
          } else if (kind === 'end') {
            const target = REF_TARGET.exec(instruction)?.[1];
            if (target !== undefined) {
              const id = `xref-${state.crossReferences.length + 1}`;
              state.crossReferences.push({ id, targetId: target });
              inline.push({ type: 'crossReference', targetId: target, display: 'number' });
            } else if (instruction.trim().length > 0) {
              state.diagnostics.push({
                code: 'field-not-imported',
                detail: `Word field "${instruction.trim()}" has no equivalent in the content model`,
              });
            }
            field = 'none';
          }
          break;
        }
        case 'w:t':
        case 'w:delText':
          capture = 'text';
          break;
        case 'w:instrText':
          capture = 'instruction';
          break;
        case 'w:sectPr':
          state.diagnostics.push({
            code: 'section-properties-not-imported',
            detail:
              'Page size, margins and column setup belong to a publishing layout, not to content',
          });
          break;
        default:
          break;
      }
      continue;
    }

    // Closing tags
    switch (name) {
      case 'w:t':
      case 'w:delText':
      case 'w:instrText':
        capture = undefined;
        break;
      case 'w:ins':
      case 'w:del':
        if (activeSuggestion !== undefined) {
          state.suggestions.push({ ...activeSuggestion, text: suggestionText });
        }
        activeSuggestion = undefined;
        suggestionText = '';
        break;
      case 'w:p': {
        const heading = /^Heading(\d)$/.exec(style ?? '');
        if (heading !== null) {
          flushComponent();
          const title = inline
            .filter((node): node is TextNode => node.type === 'text')
            .map((node) => node.text)
            .join('')
            .trim();
          state.outline.push({
            id: `s${state.outline.length + 1}`,
            title,
            level: Number.parseInt(heading[1]!, 10),
            ...(bookmark === undefined ? {} : { bookmark }),
            componentIds: [],
          });
        } else if (inline.length > 0) {
          state.blocks.push(paragraph(inline));
        } else {
          state.emptyParagraphs += 1;
        }
        inline = [];
        break;
      }
      default:
        break;
    }
  }

  flushComponent();

  if (state.emptyParagraphs > 0) {
    state.diagnostics.push({
      code: 'empty-paragraphs-dropped',
      detail: `${state.emptyParagraphs} empty paragraph(s) dropped - vertical spacing is a style, not content`,
    });
  }

  return {
    outline: state.outline,
    components: state.components,
    threads,
    suggestions: state.suggestions,
    footnotes: [...usedFootnotes].map((id) => ({
      id: `fn-${id}`,
      text: footnoteText.get(id) ?? '',
    })),
    crossReferences: state.crossReferences,
    diagnostics: state.diagnostics,
    parts,
  };
}
