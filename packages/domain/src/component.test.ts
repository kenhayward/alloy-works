import { describe, expect, it } from 'vitest';

import { createComponent, nextVersion, parseComponent } from './component.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('createComponent', () => {
  it('assigns an identity and starts at version 1', () => {
    const component = createComponent({
      type: 'topic',
      title: 'Install the printer',
      body: 'Steps.',
    });

    expect(component.id).toMatch(UUID);
    expect(component.version).toBe(1);
    expect(component.type).toBe('topic');
    expect(component.title).toBe('Install the printer');
    expect(component.body).toBe('Steps.');
  });

  it('gives each component a distinct identity', () => {
    const one = createComponent({ type: 'concept', title: 'Toner', body: '' });
    const two = createComponent({ type: 'concept', title: 'Toner', body: '' });

    expect(one.id).not.toBe(two.id);
  });

  it('rejects a blank title, because a component with no title cannot be reused', () => {
    expect(() => createComponent({ type: 'topic', title: '   ', body: 'Steps.' })).toThrow(
      /title/i,
    );
  });
});

describe('parseComponent', () => {
  it('accepts a well-formed component', () => {
    const component = createComponent({ type: 'task', title: 'Replace toner', body: 'Steps.' });

    expect(parseComponent(JSON.parse(JSON.stringify(component)))).toEqual(component);
  });

  it('rejects an unknown component type', () => {
    const stored = { ...createComponent({ type: 'task', title: 'A', body: '' }), type: 'invoice' };

    expect(() => parseComponent(stored)).toThrow();
  });

  it('rejects a version below 1', () => {
    const stored = { ...createComponent({ type: 'task', title: 'A', body: '' }), version: 0 };

    expect(() => parseComponent(stored)).toThrow();
  });

  it('rejects a value that is not an object at all', () => {
    expect(() => parseComponent('topic')).toThrow();
  });
});

describe('nextVersion', () => {
  it('increments the version and keeps the identity', () => {
    const first = createComponent({ type: 'topic', title: 'Install', body: 'Old.' });
    const second = nextVersion(first, { body: 'New.' });

    expect(second.id).toBe(first.id);
    expect(second.version).toBe(2);
    expect(second.body).toBe('New.');
    expect(second.title).toBe('Install');
  });

  it('does not mutate the component it was given', () => {
    const first = createComponent({ type: 'topic', title: 'Install', body: 'Old.' });
    nextVersion(first, { body: 'New.' });

    expect(first.body).toBe('Old.');
    expect(first.version).toBe(1);
  });

  it('applies the same validation as creation', () => {
    const first = createComponent({ type: 'topic', title: 'Install', body: 'Old.' });

    expect(() => nextVersion(first, { title: '' })).toThrow(/title/i);
  });
});
