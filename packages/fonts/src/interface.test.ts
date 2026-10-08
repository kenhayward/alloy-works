import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { INTERFACE_FONT_FILES, PINNED_FONT_FILES } from './index.js';
import { FONT_DIRECTORY, INTERFACE_FONT_DIRECTORY } from './node.js';

describe('the interface faces (ADR-0046)', () => {
  it('pins each file by hash, with the Plex licence beside them', () => {
    for (const face of INTERFACE_FONT_FILES) {
      const bytes = readFileSync(join(INTERFACE_FONT_DIRECTORY, face.file));
      expect(createHash('sha256').update(bytes).digest('hex'), face.file).toBe(face.sha256);
    }
    const licence = readFileSync(join(INTERFACE_FONT_DIRECTORY, 'LICENSE-Plex.txt'), 'utf8');
    expect(licence).toContain('Reserved Font Name "Plex"');
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(readdirSync(INTERFACE_FONT_DIRECTORY).sort()).toEqual(
      [...INTERFACE_FONT_FILES.map((face) => face.file), 'LICENSE-Plex.txt'].sort(),
    );
  });

  it('keeps them apart from the publishing faces: none in the folder Typst is given, none pinned for a theme', () => {
    const publishing = readdirSync(FONT_DIRECTORY);
    const families = new Set<string>(PINNED_FONT_FILES.map((each) => each.family));
    for (const face of INTERFACE_FONT_FILES) {
      expect(publishing).not.toContain(face.file);
      expect(families.has(face.family), face.family).toBe(false);
    }
  });

  it('holds Plex Sans in its regular, italic, medium and semibold, and Plex Mono in its regular and medium', () => {
    expect(
      INTERFACE_FONT_FILES.map(({ family, weight, style }) => `${family} ${weight} ${style}`),
    ).toEqual([
      'IBM Plex Sans 400 normal',
      'IBM Plex Sans 400 italic',
      'IBM Plex Sans 500 normal',
      'IBM Plex Sans 600 normal',
      'IBM Plex Mono 400 normal',
      'IBM Plex Mono 500 normal',
    ]);
  });
});
