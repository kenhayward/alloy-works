// Phase 3: the compressed sizes of case 7's generated inputs, for the findings. Throwaway.
import zlib from 'node:zlib';
import { xlsxOfRows, xlsxSharedStringBomb } from './lib/bombs.mjs';
const MB = 1024 * 1024;
const out = {};
out.xlsxRows10MB = (await xlsxOfRows(10 * MB)).length;
out.xlsxRows100MB = (await xlsxOfRows(100 * MB)).length;
out.xlsxRows1000MB = (await xlsxOfRows(1000 * MB)).length;
out.xlsxSst600MB = (await xlsxSharedStringBomb(600 * MB)).length;
// The gzip body the fake source sends for 1 GB: compress the same filler, counting output only.
const unit = Buffer.from('{"id":12345,"v":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"},');
const gz = zlib.createGzip({ level: 9 }); let size = 0; gz.on('data', (c) => { size += c.length; });
const done = new Promise((r) => gz.on('end', r));
const block = Buffer.concat(Array(16384).fill(unit));
for (let sent = 0; sent < 1000 * MB; sent += block.length) { if (!gz.write(block)) await new Promise((r) => gz.once('drain', r)); }
gz.end(); await done;
out.gzip1000MB = size;
console.log(JSON.stringify(out));
