import { describe, expect, it } from 'vitest';

import { faceFamily, projectFontFaces } from './faces.js';
import { resolved } from './theme.fixture.js';

const theme = resolved();
const everyFile = [...theme.typefaces.values()].flatMap((typeface) => typeface.files);
const bundled = (sha256: string) => `./assets/${sha256.slice(0, 8)}.ttf`;

describe('projectFontFaces', () => {
  it('declares each file of each typeface under a family of its own, never the face\'s real name', () => {
    const { css, unheld } = projectFontFaces(theme, bundled);
    expect(unheld).toEqual([]);
    expect(css.match(/@font-face/g)).toHaveLength(everyFile.length);
    expect(faceFamily('serif')).toBe('aw-face-serif');
    // A Liberation Serif installed on the reader's machine is never what the editor sets text in.
    expect(css).not.toContain('Liberation');
    const regular = theme.typefaces.get('serif')!.files.find(
      (file) => file.weight === 'regular' && file.posture === 'normal',
    )!;
    expect(css).toContain(
      `@font-face { font-family: "aw-face-serif"; src: url("${bundled(regular.sha256)}"); ` +
        'font-weight: 400; font-style: normal; font-display: block; }',
    );
    const boldItalic = theme.typefaces.get('serif')!.files.find(
      (file) => file.weight === 'bold' && file.posture === 'italic',
    )!;
    expect(css).toContain(
      `src: url("${bundled(boldItalic.sha256)}"); font-weight: 700; font-style: italic;`,
    );
  });

  it('declares none of a typeface one of whose files is not held, and names its family', () => {
    const [missing] = theme.typefaces.get('mono')!.files;
    const { css, unheld } = projectFontFaces(theme, (sha256) =>
      sha256 === missing!.sha256 ? undefined : bundled(sha256),
    );
    expect(unheld).toEqual(['Liberation Mono']);
    expect(css).not.toContain('aw-face-mono');
    expect(css).toContain('aw-face-serif');
  });

  it('refuses a URL that could end its own declaration', () => {
    expect(() => projectFontFaces(theme, () => 'x"); color: red; ("')).toThrow(/not a URL/);
  });
});
