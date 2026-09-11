import { describe, expect, it } from 'vitest';

import { exampleTheme } from './example.js';
import { themeSchema } from './schema.js';

/**
 * The property set is the contract every projection is written against (docs/design/themes.md).
 * Anything outside it must be refused at the door, not ignored downstream - a property a theme
 * sets and no renderer honours is a style that silently does nothing.
 */
describe('theme schema', () => {
  it('accepts the example theme', () => {
    expect(() => themeSchema.parse(exampleTheme())).not.toThrow();
  });

  it('refuses a property the set does not have', () => {
    const theme = exampleTheme();
    const body = theme.paragraphStyles[0]!;
    const withExtra = { ...body, properties: { ...body.properties, letterSpacing: 1 } };
    expect(() => themeSchema.parse({ ...theme, paragraphStyles: [withExtra] })).toThrow();
  });

  it('accepts colour only as lower-case six-digit hex', () => {
    for (const paper of ['#FFFFFF', 'red', '#fff', 'rgb(0,0,0)']) {
      expect(() => themeSchema.parse({ ...exampleTheme(), paper }), paper).toThrow();
    }
  });

  it('refuses a style id that is not safe verbatim as a class, a key and a Word style id', () => {
    const theme = exampleTheme();
    const renamed = { ...theme.paragraphStyles[0]!, id: 'Body Text' };
    expect(() => themeSchema.parse({ ...theme, paragraphStyles: [renamed] })).toThrow();
  });

  it('refuses a family name that could escape the syntax it is written into', () => {
    const theme = exampleTheme();
    const evil = { ...theme.typefaces[0]!, family: 'Evil"; } body { color: red' };
    expect(() => themeSchema.parse({ ...theme, typefaces: [evil] })).toThrow();
  });

  it('requires every default to be stated, because defaults end every inheritance chain', () => {
    const theme = exampleTheme();
    const partial: Record<string, unknown> = { ...theme.defaults };
    delete partial['lineSpacing'];
    expect(() => themeSchema.parse({ ...theme, defaults: partial })).toThrow();
  });
});
