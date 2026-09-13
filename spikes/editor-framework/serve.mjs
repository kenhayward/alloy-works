// Throwaway static server for the spike page. Not product code.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};
const root = resolve(process.cwd());
const port = Number(process.argv[2] ?? 8099);

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  while (path.startsWith('/')) path = path.slice(1);
  const file = resolve(join(root, normalize(path === '' ? 'index.html' : path)));
  if (!file.startsWith(root)) {
    res.writeHead(403).end('no');
    return;
  }
  try {
    const body = await readFile(file);
    res
      .writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
      .end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`spike page on http://127.0.0.1:${port}/`));
