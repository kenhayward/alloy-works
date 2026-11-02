import { DEFAULT_CATALOGUES_BY_VERSION, DEFAULT_THEME, readTheme } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { imageChoices, paragraphChoices, tableChoices } from './StyleChoice.js';

/** The default theme, narrowed to what `allowed` names, read as the editor reads it. */
function themed(allowed?: typeof DEFAULT_THEME.allowed) {
  const outcome = readTheme({ ...DEFAULT_THEME, allowed }, DEFAULT_CATALOGUES_BY_VERSION);
  if (!outcome.ok) throw new Error(outcome.refusals.map((each) => each.message).join('; '));
  return outcome.theme;
}

const values = (choices: readonly { value: string }[]) => choices.map((each) => each.value);

describe('the styles an author is offered (the SY plan, SY-H)', () => {
  it('STY-033 offers authors only the styles the theme allows, a place default always among them', () => {
    expect(values(paragraphChoices(themed(), ['text'])).length).toBeGreaterThan(2);

    const narrowed = themed({ paragraph: ['lead'], table: ['table'], image: ['figure'] });
    expect(values(paragraphChoices(narrowed, ['text']))).toEqual(['body', 'lead']);
    expect(values(tableChoices(narrowed))).toEqual(['table']);
    expect(values(imageChoices(narrowed, 'figure'))).toEqual(['figure']);
    // A kind the theme does not narrow offers every style of it.
    expect(values(tableChoices(themed({ paragraph: ['lead'] })))).toEqual(
      values(tableChoices(themed())),
    );
  });
});
