// List a PDF's font dictionaries (BaseFont, Subtype, font-file kind) and which font programs carry
// which family names in their own bytes - to tell a named face from the glyphs actually embedded.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
const b = readFileSync(process.argv[2]);
const s = b.toString('latin1');
const objs = {};
for (const m of s.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g))
  objs[m[1]] = { text: m[2], start: m.index };
for (const [n, o] of Object.entries(objs)) {
  if (/\/Type\s*\/Font\b/.test(o.text) || /\/FontDescriptor/.test(o.text)) {
    const bf = o.text.match(/\/(BaseFont|FontName)\s*\/([^\s/>]+)/);
    const sub = o.text.match(/\/Subtype\s*\/(\w+)/);
    const ff = o.text.match(/\/(FontFile2?|FontFile3)\s+(\d+)/);
    let names = '';
    if (ff) {
      const fo = objs[ff[2]];
      const i = s.indexOf('stream', fo.start) + 6;
      const st = i + (s[i] === '\r' ? 2 : 1);
      const e = s.indexOf('endstream', st);
      let d;
      try {
        d = inflateSync(b.subarray(st, e));
      } catch {
        d = b.subarray(st, e);
      }
      const txt = d.toString('latin1') + d.toString('utf16le');
      let be = '';
      try {
        be = Buffer.from(d).swap16().toString('utf16le');
      } catch {
        // An odd-length program cannot be read as big-endian UTF-16; its Latin-1 reading stands.
      }
      names = ['STIX', 'Liberation', 'Calibri', 'Cambria', 'Times']
        .filter((k) => txt.includes(k) || be.includes(k))
        .join(',');
      names = `${ff[1]} obj ${ff[2]} ${d.length} bytes, names in program: [${names}]`;
    }
    console.log(`obj ${n}: ${bf ? bf[2] : ''} ${sub ? sub[1] : ''} ${names}`);
  }
}
