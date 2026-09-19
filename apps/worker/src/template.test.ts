import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DRAFT_NOTICE } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { PIPELINE_VERSION } from './jobs/publish.js';
import { PUBLICATION_TEMPLATE } from './template.js';

describe('the publication template', () => {
  it('is the version its number says: an edit is a new version, never a change to this one', async () => {
    const bytes = await readFile(PUBLICATION_TEMPLATE.file);
    // Of the file with LF endings (.gitattributes normalises them). Were this to fail, the template
    // changed: put it back and make templates/publication/2/, never move this hash. It moved once,
    // before anything was published: the document's title became a heading (it had been Typst's
    // `title()`, which a screen reader hears as a paragraph), so no publication names the old bytes.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'e8afabbac53bb797cfb024937ef4387834994a2d50062a029510d9ff300f58b0',
    );
    expect(PUBLICATION_TEMPLATE).toMatchObject({ name: 'publication', version: 1 });
  });
});

describe('the pipeline version', () => {
  it('changes whenever the draft notice does, which the template carries and its hash does not cover', () => {
    // The notice's words come from `DRAFT_NOTICE` in packages/domain, through `assemble`, so a change
    // to them changes no template byte. The record names them by the pipeline version instead: each
    // version, the notice it sets. Never edit a row - new words are a new pipeline version and a new
    // row, and a publication made before still names the words it carries.
    const noticeByPipeline: Record<string, string> = {
      '1': '6d8998673c9eae61090d59f3918f1801592a406b072865f6916db166de213486',
    };
    expect(createHash('sha256').update(JSON.stringify(DRAFT_NOTICE)).digest('hex')).toBe(
      noticeByPipeline[PIPELINE_VERSION],
    );
  });
});
