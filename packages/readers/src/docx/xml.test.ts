import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readXml, type XmlNode } from './xml.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const keepT = { text: (name: string) => name === 'w:t' };

describe('readXml', () => {
  it('names elements and attributes by their namespace, whatever prefix the file uses', () => {
    const read = readXml(
      strToU8(
        `<x:document xmlns:x="${W}"><x:p><x:pPr><x:pStyle x:val="Heading1"/></x:pPr><x:r><x:t>Ada</x:t></x:r></x:p></x:document>`,
      ),
      keepT,
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const p = read.root.children[0] as XmlNode;
    expect(read.root.name).toBe('w:document');
    expect(p.name).toBe('w:p');
    const style = (p.children[0] as XmlNode).children[0] as XmlNode;
    expect(style).toMatchObject({ name: 'w:pStyle', attributes: { 'w:val': 'Heading1' } });
    const t = ((p.children[1] as XmlNode).children[0] as XmlNode).children;
    expect(t).toEqual(['Ada']);
  });

  it('keeps text only where asked, and leaves out what it is told to skip', () => {
    const read = readXml(
      strToU8(
        `<w:p xmlns:w="${W}"> <w:drawing><w:t>inside</w:t></w:drawing><w:r><w:t>kept</w:t></w:r></w:p>`,
      ),
      { ...keepT, skip: (name) => name === 'w:drawing' },
    );
    expect(read.ok && read.root.children).toEqual([
      { name: 'w:drawing', attributes: {}, children: [] },
      {
        name: 'w:r',
        attributes: {},
        children: [{ name: 'w:t', attributes: {}, children: ['kept'] }],
      },
    ]);
  });

  it('refuses a document type, so a billion laughs never expands', () => {
    const laughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol9 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
]>
<lolz>&lol9;</lolz>`;
    expect(readXml(strToU8(laughs), keepT)).toMatchObject({ ok: false, refusal: 'doctype' });
  });

  it('refuses an external entity, so nothing outside the file is read', () => {
    const external = `<?xml version="1.0"?>
<!DOCTYPE w:document [<!ENTITY secret SYSTEM "file:///etc/passwd">]>
<w:document xmlns:w="${W}"><w:t>&secret;</w:t></w:document>`;
    expect(readXml(strToU8(external), keepT)).toMatchObject({ ok: false, refusal: 'doctype' });
    // And one used with no declaration at all is not well formed.
    const undeclared = `<w:document xmlns:w="${W}"><w:t>&secret;</w:t></w:document>`;
    expect(readXml(strToU8(undeclared), keepT)).toMatchObject({ ok: false, refusal: 'malformed' });
  });

  it('refuses more elements, or deeper, than its caps', () => {
    const wide = `<w:body xmlns:w="${W}">${'<w:p/>'.repeat(50)}</w:body>`;
    expect(readXml(strToU8(wide), keepT, { nodes: 20, depth: 10 })).toMatchObject({
      ok: false,
      refusal: 'nodes',
    });
    const deep = `<w:body xmlns:w="${W}">${'<w:sdt>'.repeat(20)}${'</w:sdt>'.repeat(20)}</w:body>`;
    expect(readXml(strToU8(deep), keepT, { nodes: 1000, depth: 10 })).toMatchObject({
      ok: false,
      refusal: 'depth',
    });
  });

  it('refuses a part of more than about half a million elements by default', () => {
    const many = (count: number) =>
      strToU8(`<w:body xmlns:w="${W}">${'<w:p/>'.repeat(count)}</w:body>`);
    expect(readXml(many(600_000), keepT)).toMatchObject({ ok: false, refusal: 'nodes' });
    expect(readXml(many(400_000), keepT).ok).toBe(true);
    // A million elements read: a quarter of a second alone, past five on a runner busy with every
    // other suite (#777).
  }, 30_000);

  it('refuses what is not well formed', () => {
    expect(readXml(strToU8(`<w:p xmlns:w="${W}"><w:r></w:p>`), keepT)).toMatchObject({
      ok: false,
      refusal: 'malformed',
    });
  });
});
