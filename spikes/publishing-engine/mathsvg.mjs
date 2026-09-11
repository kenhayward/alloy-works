// Throwaway. LaTeX to SVG with MathJax, for WeasyPrint, which cannot typeset mathematics itself.
// Reads [{latex, display}] on stdin; writes [{svg, w, h, valign}] with sizes in ex.
/* global process, console */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const html = mathjax.document('', {
  InputJax: new TeX({ packages: ['base', 'ams'] }),
  OutputJax: new SVG({ fontCache: 'none' }),
});

let input = '';
for await (const chunk of process.stdin) input += chunk;
const out = JSON.parse(input).map(({ latex, display }) => {
  const node = html.convert(latex, { display });
  const svg = adaptor.innerHTML(node);
  const num = (re) => Number((svg.match(re) || [0, '0'])[1]);
  return {
    svg: svg.includes('xmlns=')
      ? svg
      : svg.replace(/^<svg /, '<svg xmlns="http://www.w3.org/2000/svg" '),
    w: num(/width="([\d.]+)ex"/),
    h: num(/height="([\d.]+)ex"/),
    valign: num(/vertical-align:\s*(-?[\d.]+)ex/),
  };
});
console.log(JSON.stringify(out));
