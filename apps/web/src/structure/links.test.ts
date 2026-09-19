import { describe, expect, it } from 'vitest';

import { documentAddress, documentLink, nodeLink } from './links.js';

const DOCUMENT = 'eeeeeeee-0000-4000-8000-000000000001';
const NODE = 'iiiiiiiiiiiiiiiiiiiiiiiiii';

describe('the addresses of a document and its nodes', () => {
  it('reads the list, a document and a node of a document, and nothing else', () => {
    expect(documentAddress('#/documents')).toEqual({ kind: 'documents' });
    expect(documentAddress(`#/documents/${DOCUMENT}`)).toEqual({
      kind: 'document',
      document: DOCUMENT,
      node: null,
    });
    expect(documentAddress(`#/documents/${DOCUMENT}/nodes/${NODE}`)).toEqual({
      kind: 'document',
      document: DOCUMENT,
      node: NODE,
    });
    for (const other of [
      '',
      '#/',
      `#/components/${DOCUMENT}`,
      `#/documents/${DOCUMENT}/nodes/`,
      `#/documents/${DOCUMENT}/nodes/${NODE.toUpperCase()}`,
      `#/documents/${DOCUMENT}/nodes/${NODE}/more`,
      `#/documents/${DOCUMENT}/nodes/${NODE.slice(1)}`,
    ]) {
      expect(documentAddress(other), other).toBeNull();
    }
  });

  it('writes an address that reads back as what it names', () => {
    expect(documentAddress(documentLink(DOCUMENT))).toEqual({
      kind: 'document',
      document: DOCUMENT,
      node: null,
    });
    expect(documentAddress(nodeLink(DOCUMENT, NODE))).toEqual({
      kind: 'document',
      document: DOCUMENT,
      node: NODE,
    });
  });
});
