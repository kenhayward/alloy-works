import { parseContentDocument, writeXliff, xliffTarget, xliffUnits } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { readXliff } from './xliff.js';

const xliff = (body: string, attributes = 'srcLang="en-GB" trgLang="fr-FR"') =>
  `<?xml version="1.0" encoding="UTF-8"?><xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.1" ${attributes}>${body}</xliff>`;
const bytes = (text: string) => new TextEncoder().encode(text);

const text = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });
const source = parseContentDocument({
  schemaVersion: 1,
  title: 'Sampling',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [
        text('See '),
        {
          type: 'crossReference',
          id: 'x1',
          target: { kind: 'block', block: 'p2' },
          display: 'number',
        },
        text(' the '),
        text('large', [{ type: 'strong', id: 'm-strong' }]),
        text(' ponds.'),
      ],
    },
    { type: 'paragraph', id: 'p2', style: 'body', content: [text('Twelve were sampled.')] },
  ],
});

describe('a returned XLIFF file', () => {
  it('LOC-018 reads a file the job wrote, translated and re-segmented by a tool, back into the variant', () => {
    const written = writeXliff({
      job: 'job-1',
      source: 'en-GB',
      target: 'fr-FR',
      files: [{ component: 'c1', title: 'Sampling', type: 'Topic', content: source }],
      terms: new Map(),
    });
    // A tool translates each segment, splits the first in two and writes its pair as a <pc>.
    const returned = written
      .replace(
        /<segment><source>See (<ph[^>]*\/>) the <sc id="m1"[^>]*\/>large<ec[^>]*\/> ponds\.<\/source><\/segment>/,
        '<segment canResegment="yes"><source>See $1</source><target>Voir $1</target></segment>' +
          '<ignorable><source> </source></ignorable>' +
          '<segment><source>the large ponds.</source><target>les <pc id="m1">grands</pc> étangs.</target></segment>',
      )
      .replace(
        '<segment><source>Twelve were sampled.</source></segment>',
        '<segment state="translated"><source>Twelve were sampled.</source><target><mrk id="q1" type="comment">Douze</mrk> ont été échantillonnés.</target></segment>',
      );
    const read = readXliff(bytes(returned));
    if (!read.ok) throw new Error(read.failure);
    expect(read.target).toBe('fr-FR');
    const units = read.files.get('f.c1')!;
    expect(units.get('b.p1')).toEqual([
      { kind: 'text', text: 'Voir ' },
      { kind: 'ph', id: 'p1' },
      { kind: 'text', text: ' ' },
      { kind: 'text', text: 'les ' },
      { kind: 'sc', id: 'm1' },
      { kind: 'text', text: 'grands' },
      { kind: 'ec', startRef: 'm1' },
      { kind: 'text', text: ' étangs.' },
    ]);
    const variant = xliffTarget(source, new Map(units as Map<string, never>), 'fr-FR');
    if (!variant.ok) throw new Error(JSON.stringify(variant.problems));
    expect(xliffUnits(variant.content).map((unit) => unit.parts)).toEqual([
      [
        { kind: 'text', text: 'Voir ' },
        { kind: 'ph', id: 'p1' },
        { kind: 'text', text: ' les ' },
        { kind: 'sc', id: 'm1' },
        { kind: 'text', text: 'grands' },
        { kind: 'ec', startRef: 'm1' },
        { kind: 'text', text: ' étangs.' },
      ],
      [{ kind: 'text', text: 'Douze ont été échantillonnés.' }],
    ]);
  });

  it('reads UTF-16, either order, and a code point as its character', () => {
    const body = xliff(
      '<file id="f.c1"><group id="g"><unit id="b.p1"><segment><source>a</source><target>Cloche<cp hex="0007"/></target></segment></unit></group></file>',
    );
    const little = new Uint8Array([
      0xff,
      0xfe,
      ...new Uint8Array(new Uint16Array([...body].map((each) => each.charCodeAt(0))).buffer),
    ]);
    const read = readXliff(little);
    if (!read.ok) throw new Error(read.failure);
    expect(read.files.get('f.c1')!.get('b.p1')).toEqual([
      { kind: 'text', text: 'Cloche' },
      { kind: 'text', text: '\u0007' },
    ]);
    const big = new Uint8Array(little.length);
    big.set([0xfe, 0xff]);
    for (let at = 2; at < little.length; at += 2) {
      big[at] = little[at + 1]!;
      big[at + 1] = little[at]!;
    }
    expect(readXliff(big).ok).toBe(true);
  });

  it('says a unit with a segment untranslated has no target', () => {
    const read = readXliff(
      bytes(
        xliff(
          '<file id="f.c1"><unit id="b.p1"><segment><source>a</source></segment></unit></file>',
        ),
      ),
    );
    expect(read.ok && read.files.get('f.c1')!.get('b.p1')).toBeNull();
  });

  it('refuses a document type, a file that is not XLIFF 2, a unit twice and an element it does not take', () => {
    expect(
      readXliff(bytes('<!DOCTYPE x [<!ENTITY e "boom">]><xliff version="2.1">&e;</xliff>')),
    ).toMatchObject({ ok: false, refusal: 'unsafe' });
    expect(readXliff(bytes('<xliff version="1.2"/>'))).toMatchObject({
      ok: false,
      refusal: 'not_xliff',
    });
    const twice = '<unit id="u"><segment><source>a</source><target>b</target></segment></unit>';
    expect(readXliff(bytes(xliff(`<file id="f">${twice}${twice}</file>`)))).toMatchObject({
      ok: false,
      refusal: 'duplicate',
    });
    expect(
      readXliff(
        bytes(
          xliff(
            '<file id="f"><unit id="u"><segment><source>a</source><target><script>b</script></target></segment></unit></file>',
          ),
        ),
      ),
    ).toMatchObject({ ok: false, refusal: 'unsupported' });
    expect(readXliff(bytes('not xml at all <'))).toMatchObject({ ok: false, refusal: 'malformed' });
  });
});
