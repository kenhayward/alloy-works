// Throwaway. Renders an HTML case to PDF with Chromium, either as-is (the headless Chrome
// candidate) or after PagedJS has paginated it (the PagedJS candidate). Same browser, same flags,
// so the two differ only in whether PagedJS ran.
//
//   node browser.mjs <chrome|pagedjs> <in.html> <out.pdf> [--pages 40] [--repeat N] [--edited x.html]
//
// Prints one JSON line of timings. With --repeat the browser stays warm between runs, which is how
// a preview would actually be served; with --edited the later runs load the edited document, so
// the timing is edit-to-page rather than cold start.
// Runs in Node, and the functions passed to page.evaluate run inside the page - hence both sets.
/* global process, console, performance, window */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const [mode, input, output, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = rest.indexOf(name);
  return i === -1 ? fallback : rest[i + 1];
};
const pages = opt('--pages', null);
const repeat = Number(opt('--repeat', '1'));
const edited = opt('--edited', null);
const polyfill = '/opt/node/node_modules/pagedjs/dist/paged.polyfill.js';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--no-sandbox', '--font-render-hinting=none', '--disable-gpu'],
});

async function renderOnce(file) {
  const page = await browser.newPage();
  const t0 = performance.now();
  let pageTarget = null;
  let pageCount = null;

  if (mode === 'pagedjs') {
    await page.evaluateOnNewDocument(
      (target) => {
        window.PagedConfig = { auto: false };
        window.__paged = { count: 0, target, targetAt: null };
      },
      pages ? Number(pages) : -1,
    );
  }
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  let tReady = performance.now();

  if (mode === 'pagedjs') {
    await page.addScriptTag({ path: polyfill });
    tReady = performance.now(); // loading the polyfill is part of every preview
    const result = await page.evaluate(async () => {
      class Counter extends window.Paged.Handler {
        afterPageLayout() {
          window.__paged.count += 1;
          if (window.__paged.count === window.__paged.target) {
            window.__paged.targetAt = performance.now();
          }
        }
      }
      window.Paged.registerHandlers(Counter);
      const start = performance.now();
      await window.PagedPolyfill.preview();
      return {
        count: window.__paged.count,
        toTarget: window.__paged.targetAt === null ? null : window.__paged.targetAt - start,
      };
    });
    pageCount = result.count;
    pageTarget = result.toTarget;
  }

  const tLayout = performance.now();
  await page.pdf({
    path: output,
    preferCSSPageSize: true,
    printBackground: true,
    tagged: true,
    outline: true,
    timeout: 0,
    ...(pages ? { pageRanges: String(pages) } : {}),
  });
  const t1 = performance.now();
  await page.close();
  return {
    total_ms: Math.round(t1 - t0),
    load_ms: Math.round(tReady - t0),
    layout_ms: Math.round(tLayout - t0),
    pdf_ms: Math.round(t1 - tLayout),
    to_target_page_ms: pageTarget === null ? null : Math.round(pageTarget),
    paged_pages: pageCount,
  };
}

const runs = [];
for (let i = 0; i < repeat; i++) {
  runs.push(await renderOnce(i > 0 && edited ? edited : input));
}
await browser.close();
console.log(JSON.stringify({ mode, runs }));
