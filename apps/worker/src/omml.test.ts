import { mathsTree, omml } from '@alloy-works/domain';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
// The converter's fixture, read as the Temml fixtures are: nothing but a test imports it.
import { EVERY_KIND_MATHML } from '../../../packages/domain/src/word/omml.fixture.js';
import { checkOoxml } from './testing/ooxml.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

/**
 * A minimal WordprocessingML package holding one equation's OMML twice - in a line of text and
 * displayed in a paragraph of its own - with `m:mathPr` naming Cambria Math in its settings, as the
 * writer will (Word 4, task 3). Built by hand, since the writer does not write equations yet.
 */
function equationDocx(equation: (display: boolean) => string): Uint8Array {
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      declaration +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="${MAIN}.document.main+xml"/>` +
        `<Override PartName="/word/settings.xml" ContentType="${MAIN}.settings+xml"/>` +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      declaration +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>',
    ),
    'word/_rels/document.xml.rels': strToU8(
      declaration +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${RELATIONSHIPS}/settings" Target="settings.xml"/>` +
        '</Relationships>',
    ),
    'word/settings.xml': strToU8(
      declaration +
        `<w:settings xmlns:w="${W}" xmlns:m="${M}">` +
        '<m:mathPr><m:mathFont m:val="Cambria Math"/><m:dispDef/></m:mathPr></w:settings>',
    ),
    'word/document.xml': strToU8(
      declaration +
        `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body>` +
        `<w:p><w:r><w:t xml:space="preserve">Ada wrote </w:t></w:r><m:oMath>${equation(false)}</m:oMath>` +
        '<w:r><w:t xml:space="preserve"> in a line.</w:t></w:r></w:p>' +
        `<w:p><m:oMathPara><m:oMath>${equation(true)}</m:oMath></m:oMathPara></w:p>` +
        '</w:body></w:document>',
    ),
  });
}

describe("the maths tree as OMML, in Word's schema (Word 4, ruling R3)", () => {
  it('writes an equation holding every kind of node, inline and displayed, which the Open XML SDK finds nothing wrong with', async () => {
    const converted = mathsTree(EVERY_KIND_MATHML);
    if (!converted.ok) throw new Error(`The fixture is refused: ${converted.reason}`);

    const bytes = equationDocx((display) =>
      omml(converted.tree, { display, size: 11, face: 'Cambria Math' }),
    );

    expect(await checkOoxml(bytes)).toEqual([]);
  });
});
