import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Icon } from './Icon.js';

describe('icons right to left (the UI plan, UI-G)', () => {
  it('LOC-004 mirrors an icon that points along the line, and no other', () => {
    const { container } = render(
      <>
        <Icon name="Back" />
        <Icon name="Next page" />
        <Icon name="Nest item" />
        <Icon name="Go to" />
        <Icon name="Section" />
        <Icon name="Close" />
        <Icon name="Strong" />
      </>,
    );
    const mirrored = [...container.querySelectorAll('[data-icon]')].map((icon) => [
      icon.getAttribute('data-icon'),
      icon.hasAttribute('data-mirrored'),
    ]);
    expect(mirrored).toEqual([
      ['Back', true],
      ['Next page', true],
      ['Nest item', true],
      ['Go to', true],
      ['Section', true],
      ['Close', false],
      ['Strong', false],
    ]);
    // Mirrored only right to left.
    expect(readFileSync(join(import.meta.dirname, 'Icon.module.css'), 'utf8')).toMatch(
      /:global\(:root\[dir='rtl'\]\) \.path\[data-mirrored\] \{\s*scale: -1 1;/,
    );
  });
});
