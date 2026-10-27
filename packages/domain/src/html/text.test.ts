import { describe, expect, it } from 'vitest';

import { htmlText } from './text.js';

const bytes = (html: string) => new TextEncoder().encode(html);

describe("an HTML output's text, as the leak scan reads it (the HT plan, HT-L)", () => {
  it('reads the text a reader is shown, its characters decoded, and not the styles', () => {
    const read = htmlText(
      bytes(
        '<!DOCTYPE html><html><head><title>Ada &amp; Grace</title>' +
          '<style>.aw-canvas::before { content: "hidden words here"; }</style></head>' +
          '<body><p>Measure&#32;twice &lt;then&gt; cut&nbsp;once &#x263A;</p></body></html>',
      ),
    );
    expect(read).toContain('Ada & Grace');
    expect(read).toContain('Measure twice <then> cut once ☺');
    expect(read).not.toContain('hidden words here');
    // A word a mark begins inside is one word still.
    expect(htmlText(bytes('<p>the re<em>cipe</em> of Ada</p>'))).toBe('the recipe of Ada');
  });

  it('reads the words an attribute says to a reader, each of its own', () => {
    for (const attribute of ['alt', 'aria-label', 'title', 'alttext']) {
      const read = htmlText(
        bytes(`<p><span ${attribute}="the secret recipe &quot;of Ada&quot;">x</span></p>`),
      );
      expect(read, attribute).toContain('the secret recipe "of Ada"');
    }
    expect(htmlText(bytes('<a href="#the-secret-recipe">x</a>'))).not.toContain('secret');
  });
});
