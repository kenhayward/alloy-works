import { describe, expect, it } from 'vitest';

import {
  baselineLink,
  comparisonLink,
  documentAccessLink,
  documentAddress,
  documentLink,
  nodeLink,
  publishingLink,
  templateAccessAddress,
  templateAccessLink,
} from './links.js';

const DOCUMENT = 'eeeeeeee-0000-4000-8000-000000000001';
const NODE = 'iiiiiiiiiiiiiiiiiiiiiiiiii';

describe('the addresses of a document and its nodes', () => {
  it('VER-025 addresses a baseline compared with a later one, or with the document now', () => {
    const BASELINE = 'bbbbbbbb-0000-4000-8000-000000000001';
    const LATER = 'bbbbbbbb-0000-4000-8000-000000000002';
    expect(documentAddress(comparisonLink(DOCUMENT, BASELINE, LATER))).toEqual({
      kind: 'comparison',
      document: DOCUMENT,
      baseline: BASELINE,
      against: LATER,
    });
    expect(documentAddress(comparisonLink(DOCUMENT, BASELINE, 'now'))).toMatchObject({
      against: 'now',
    });
    expect(
      documentAddress(`#/documents/${DOCUMENT}/baselines/${BASELINE}/compare/later`),
    ).toBeNull();
  });

  it('STR-047 addresses a document as a baseline holds it, and a node in it, and reads them back', () => {
    const BASELINE = 'bbbbbbbb-0000-4000-8000-000000000001';
    expect(baselineLink(DOCUMENT, BASELINE)).toBe(`#/documents/${DOCUMENT}/baselines/${BASELINE}`);
    expect(documentAddress(baselineLink(DOCUMENT, BASELINE, NODE))).toEqual({
      kind: 'baseline',
      document: DOCUMENT,
      baseline: BASELINE,
      node: NODE,
    });
    expect(documentAddress(baselineLink(DOCUMENT, BASELINE))).toEqual({
      kind: 'baseline',
      document: DOCUMENT,
      baseline: BASELINE,
      node: null,
    });
    for (const other of [
      `#/documents/${DOCUMENT}/baselines`,
      `#/documents/${DOCUMENT}/baselines/${BASELINE}/nodes`,
      `#/documents/${DOCUMENT}/baselines/${BASELINE}/more`,
    ]) {
      expect(documentAddress(other), other).toBeNull();
    }
  });

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

  it('addresses a document opened at its Publishing panel, and at a failed request there, and reads them back', () => {
    const REQUEST = 'ffffffff-0000-4000-8000-000000000001';
    expect(publishingLink(DOCUMENT)).toBe(`#/documents/${DOCUMENT}/publishing`);
    expect(documentAddress(publishingLink(DOCUMENT))).toEqual({
      kind: 'publishing',
      document: DOCUMENT,
      request: null,
    });
    expect(publishingLink(DOCUMENT, REQUEST)).toBe(
      `#/documents/${DOCUMENT}/publishing/requests/${REQUEST}`,
    );
    expect(documentAddress(publishingLink(DOCUMENT, REQUEST))).toEqual({
      kind: 'publishing',
      document: DOCUMENT,
      request: REQUEST,
    });
    for (const other of [
      `#/documents/${DOCUMENT}/publishing/more`,
      `#/documents/${DOCUMENT}/publishing/requests`,
      `#/documents/${DOCUMENT}/publishing/requests/${REQUEST}/more`,
    ]) {
      expect(documentAddress(other), other).toBeNull();
    }
  });
});

describe('the addresses of access to a document and to a template', () => {
  const TEMPLATE = 'ffffffff-0000-4000-8000-000000000001';

  it("reads a document's access page, and writes an address that reads back as it", () => {
    expect(documentAddress(`#/documents/${DOCUMENT}/access`)).toEqual({
      kind: 'access',
      document: DOCUMENT,
    });
    expect(documentAddress(documentAccessLink(DOCUMENT))).toEqual({
      kind: 'access',
      document: DOCUMENT,
    });
    expect(documentAddress(`#/documents/${DOCUMENT}/access/more`)).toBeNull();
    expect(documentAddress(`#/documents/${DOCUMENT}/nodes/${NODE}/access`)).toBeNull();
  });

  it("reads a template's access page, and nothing else", () => {
    expect(templateAccessAddress(`#/templates/${TEMPLATE}/access`)).toBe(TEMPLATE);
    expect(templateAccessAddress(templateAccessLink(TEMPLATE))).toBe(TEMPLATE);
    for (const other of [
      '#/templates',
      `#/templates/${TEMPLATE}`,
      `#/documents/${TEMPLATE}/access`,
    ]) {
      expect(templateAccessAddress(other), other).toBeNull();
    }
  });
});
