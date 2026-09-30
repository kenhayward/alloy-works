import { describe, expect, it } from 'vitest';

import { moduleOf } from './moduleOf.js';

const COMPONENT = '0b5e2c8e-6f5b-4a8e-9d3c-2a1b0c9d8e7f';
const NODE = 'abcdefghijklmnopqrstuvwxyz';

describe('the module an address belongs to', () => {
  it('names no module for Home: the empty hash, # and #/', () => {
    expect(moduleOf('')).toBeNull();
    expect(moduleOf('#')).toBeNull();
    expect(moduleOf('#/')).toBeNull();
  });

  it('names Components for the list and a component', () => {
    expect(moduleOf('#/components')).toBe('Components');
    expect(moduleOf(`#/components/${COMPONENT}`)).toBe('Components');
    expect(moduleOf(`#/components/${COMPONENT}/access`)).toBe('Components');
  });

  it('names Documents for the list, a document and a part', () => {
    expect(moduleOf('#/documents')).toBe('Documents');
    expect(moduleOf(`#/documents/${COMPONENT}`)).toBe('Documents');
    expect(moduleOf(`#/documents/${COMPONENT}/nodes/${NODE}`)).toBe('Documents');
  });

  it('names Templates for the templates list', () => {
    expect(moduleOf('#/templates')).toBe('Templates');
  });

  it('names Connections for the list, a connection and its access', () => {
    expect(moduleOf('#/connections')).toBe('Connections');
    expect(moduleOf(`#/connections/${COMPONENT}`)).toBe('Connections');
    expect(moduleOf(`#/connections/${COMPONENT}/access`)).toBe('Connections');
  });

  it('names Search for a search, with its query or without', () => {
    expect(moduleOf('#/search')).toBe('Search');
    expect(moduleOf('#/search?q=lever%20arm')).toBe('Search');
  });

  it('names Publications for a publication', () => {
    expect(moduleOf(`#/publications/${COMPONENT}`)).toBe('Publications');
  });
});
