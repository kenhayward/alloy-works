import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { titleIn, TranslatedTitles } from './TranslatedTitles.js';

const SECTION = 'methods'.padEnd(26, 'a');

describe('titles in a language (the TR plan, TR-L)', () => {
  it('says how many titles have words in the language, and gives or clears each changed, one act each', async () => {
    const onSave = vi.fn(async () => true);
    render(
      <TranslatedTitles
        language="fr"
        mayEdit
        onSave={onSave}
        titles={[
          { node: null, own: 'Pond survey', translated: 'Étude des étangs' },
          { node: SECTION, own: '1 Methods', translated: undefined },
        ]}
      />,
    );
    expect(
      screen.getByText(
        /Titles in fr: 1 of 2 given; the rest print in the document's own language\./,
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Translate titles' }));
    await userEvent.type(screen.getByRole('textbox', { name: '1 Methods' }), 'Méthodes');
    await userEvent.clear(screen.getByRole('textbox', { name: 'The document: Pond survey' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onSave.mock.calls).toEqual([
        [{ operation: 'translateTitle', node: null, language: 'fr', title: null }],
        [{ operation: 'translateTitle', node: SECTION, language: 'fr', title: 'Méthodes' }],
      ]),
    );
  });

  it('reads a title by a language it serves, its exact tag first', () => {
    expect(titleIn({ fr: 'Méthodes', 'fr-CA': 'Méthodes (CA)' }, 'fr-CA')).toBe('Méthodes (CA)');
    expect(titleIn({ 'fr-FR': 'Méthodes' }, 'fr')).toBe('Méthodes');
    expect(titleIn({ de: 'Methoden' }, 'fr')).toBeUndefined();
  });
});
