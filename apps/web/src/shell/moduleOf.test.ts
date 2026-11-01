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
    expect(moduleOf(`#/imports/${COMPONENT}`)).toBe('Documents');
  });

  it('names Bibliography for the list and an entry', () => {
    expect(moduleOf('#/bibliography')).toBe('Bibliography');
    expect(moduleOf(`#/bibliography/${COMPONENT}`)).toBe('Bibliography');
    expect(moduleOf('#/terms')).toBe('Terms');
    expect(moduleOf(`#/terms/${COMPONENT}`)).toBe('Terms');
  });

  it('names Images for the list', () => {
    expect(moduleOf('#/images')).toBe('Images');
  });

  it('names Administration for its page and each of its sections, which no module holds', () => {
    expect(moduleOf('#/admin')).toBe('Administration');
    expect(moduleOf('#/admin/spaces')).toBe('Administration');
    expect(moduleOf('#/administrator')).toBe('Components');
  });

  it('names Templates for the templates list, the cohorts list and a cohort', () => {
    expect(moduleOf('#/templates')).toBe('Templates');
    expect(moduleOf('#/cohorts')).toBe('Templates');
    expect(moduleOf('#/cohorts/cccccccc-0000-4000-8000-000000000001')).toBe('Templates');
  });

  it('names Query definitions for the list, a definition and a new one', () => {
    expect(moduleOf('#/query-definitions')).toBe('Query definitions');
    expect(moduleOf(`#/query-definitions/${COMPONENT}`)).toBe('Query definitions');
    expect(moduleOf('#/query-definitions/new')).toBe('Query definitions');
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
