// Throwaway. Measures the editor's rendering of the fixture in Chromium: each line's baseline and
// start, read from a zero-size marker whose bottom edge sits on the baseline, and the computed
// size, weight, posture and colour of each token and marked word. CSS pixels become points at 0.75.
/* global process, console, document, getComputedStyle */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--no-sandbox', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await page.goto(pathToFileURL(process.argv[2]).href, { waitUntil: 'load' });
const result = await page.evaluate(async () => {
  await document.fonts.ready;
  const PT = 0.75;
  const style = (el) => {
    const cs = getComputedStyle(el);
    return {
      size: parseFloat(cs.fontSize) * PT,
      bold: Number(cs.fontWeight) >= 600,
      italic: cs.fontStyle === 'italic',
      colour: cs.color,
      family: cs.fontFamily,
    };
  };
  const lines = [...document.querySelectorAll('.m')].map((marker) => {
    const r = marker.getBoundingClientRect();
    const tok = document.querySelector(`[data-tok="${marker.dataset.t}"]`);
    return { token: marker.dataset.t, y: r.bottom * PT, x: r.left * PT, ...style(tok) };
  });
  const words = [...document.querySelectorAll('[data-word]')].map((w) => ({
    word: w.dataset.word,
    ...style(w),
  }));
  return { lines, words, fontLoaded: document.fonts.check('11pt "Liberation Serif"') };
});
await browser.close();
console.log(JSON.stringify(result));
