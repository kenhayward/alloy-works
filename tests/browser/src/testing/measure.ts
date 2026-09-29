import type { Page } from 'playwright-core';
import type {
  Edge,
  Measured,
  MeasuredImage,
  MeasuredMarker,
  MeasuredRule,
  MeasuredRules,
} from '@alloy-works/conformance';

/**
 * **The editor's half of the measurement** (the W13 plan's W13.4, step 4): each token, image, cell's
 * rules, equation's face and list's marker as the document view draws them, in the shapes
 * `@alloy-works/conformance` measures the PDF's in and compares both by (the W15 plan's W15-C).
 */

/** Points to CSS pixels: a CSS inch is 96 pixels and 72 points. */
const PX_PER_PT = 96 / 72;

/**
 * Each token as the editor draws it in the document view's text (the W13 plan's W13.4, step 4): a
 * zero-size marker set just before its first letter gives its start and its baseline - an empty inline
 * block stands on the baseline of its line - and is taken out again at once; the computed style of the
 * element the token's text is in gives its size, face, weight, posture and colour. `families` names the
 * family each of the theme's faces is given under in the page (`aw-face-serif`) as the files name it.
 * Measured at the canvas's own zoom, which the caller holds at one.
 */
export async function measureEditor(
  page: Page,
  tokens: readonly string[],
  families: Readonly<Record<string, string>>,
): Promise<Map<string, Measured>> {
  const found = await page.evaluate(
    ({ tokens, pxPerPt }) => {
      const text = document.querySelector<HTMLElement>('section.aw-canvas');
      if (!text) throw new Error('The document has no canvas');
      const origin = text.getBoundingClientRect();
      const style = getComputedStyle(text);
      const left = origin.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
      const top = origin.top;
      const hex = (rgb: string) => {
        const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).map(Number);
        return `#${[r, g, b]
          .map((each) =>
            Math.round(each ?? 0)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')}`;
      };
      const answers: Record<string, unknown> = {};
      const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.parentElement?.closest('[data-label], button')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
      // Found first, then marked all at once from the last back, so that splitting a text node for
      // one marker moves no offset another still needs. A marker is no wide and no tall: setting them
      // all moves nothing.
      const wanted = new Set(tokens);
      const targets: { word: string; node: Text; offset: number; element: Element }[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of (node.nodeValue ?? '').matchAll(/\S+/g)) {
          const word = match[0];
          if (!wanted.has(word)) continue;
          wanted.delete(word);
          targets.push({
            word,
            node: node as Text,
            offset: match.index,
            element: node.parentElement!,
          });
        }
      }
      const markers = targets
        .slice()
        .reverse()
        .map((target) => {
          const range = document.createRange();
          range.setStart(target.node, target.offset);
          range.collapse(true);
          const marker = document.createElement('span');
          marker.style.cssText =
            'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;vertical-align:baseline';
          range.insertNode(marker);
          return { target, marker };
        })
        .reverse();
      /** The first colour an element or what holds it is filled with: a colour, or a gradient's. */
      const behind = (element: Element | null): string => {
        for (let at = element; at; at = at.parentElement) {
          const computed = getComputedStyle(at);
          // A fill painted as a gradient, unless it paints nothing: an unfilled style's is transparent.
          const gradient = /linear-gradient\((rgba?\([^)]*\))/.exec(computed.backgroundImage);
          if (gradient && !/rgba\([^)]*,\s*0\)/.test(gradient[1]!)) return hex(gradient[1]!);
          const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(computed.backgroundColor);
          if (!alpha || Number(alpha[1]) > 0) {
            if (computed.backgroundColor !== 'transparent') return hex(computed.backgroundColor);
          }
          if (at === text) break;
        }
        return 'none';
      };
      const underlined = (element: Element | null): boolean => {
        for (let at = element; at && at !== text; at = at.parentElement) {
          if (getComputedStyle(at).textDecorationLine.includes('underline')) return true;
        }
        return false;
      };
      for (const { target, marker } of markers) {
        const at = marker.getBoundingClientRect();
        const computed = getComputedStyle(target.element);
        const block =
          target.element.closest(
            'p, figcaption, footer, pre, h1, h2, h3, h4, h5, h6, li, td, th',
          ) ?? target.element;
        const whole = document.createRange();
        whole.selectNodeContents(block);
        const onLine = [...whole.getClientRects()].filter(
          (rect) => rect.width > 0 && rect.top <= at.bottom && rect.bottom >= at.bottom,
        );
        answers[target.word] = {
          underline: underlined(target.element),
          background: behind(target.element),
          line: [
            (Math.min(...onLine.map((rect) => rect.left)) - left) / pxPerPt,
            (Math.max(...onLine.map((rect) => rect.right)) - left) / pxPerPt,
          ],
          x: (at.left - left) / pxPerPt,
          baseline: (at.bottom - top) / pxPerPt,
          size: parseFloat(computed.fontSize) / pxPerPt,
          family: computed.fontFamily
            .split(',')[0]!
            .trim()
            .replace(/^["']|["']$/g, ''),
          bold: Number(computed.fontWeight) >= 600,
          italic: computed.fontStyle === 'italic',
          colour: hex(computed.color),
        };
      }
      for (const { target, marker } of markers) {
        marker.remove();
        target.element.normalize();
      }
      // Preformatted text's label is drawn from its attribute, before its lines, where no marker can
      // stand: how it is set is read from the label's own computed style, and where its word starts
      // from its box - the block's, less the insets that stand it out of the block's own indents -
      // its margins, padding and first-line indent, and its alignment, with the word's own width.
      for (const word of wanted) {
        const labelled = text.querySelector<HTMLElement>(`pre[data-language="${word}"]`);
        if (!labelled) continue;
        const computed = getComputedStyle(labelled, '::before');
        const painted = /linear-gradient\((rgba?\([^)]*\))/.exec(computed.backgroundImage);
        const gradient = painted && !/rgba\([^)]*,\s*0\)/.test(painted[1]!) ? painted : null;
        const filled = !/rgba\([^)]*,\s*0\)|transparent/.test(computed.backgroundColor);
        const block = labelled.getBoundingClientRect();
        const px = (value: string) => parseFloat(value) || 0;
        const boxLeft = block.left + px(computed.left);
        const boxRight = block.right - px(computed.right);
        const contentLeft = boxLeft + px(computed.marginLeft) + px(computed.paddingLeft);
        const contentRight = boxRight - px(computed.marginRight) - px(computed.paddingRight);
        const probe = document.createElement('span');
        probe.textContent = word;
        probe.style.cssText =
          `position:absolute;visibility:hidden;white-space:pre;font-family:${computed.fontFamily};` +
          `font-size:${computed.fontSize};font-weight:${computed.fontWeight};` +
          `font-style:${computed.fontStyle};letter-spacing:${computed.letterSpacing}`;
        document.body.append(probe);
        const wide = probe.getBoundingClientRect().width;
        probe.remove();
        const align = computed.textAlign;
        const start =
          align === 'center'
            ? contentLeft + (contentRight - contentLeft - wide) / 2
            : align === 'end' || align === 'right'
              ? contentRight - wide
              : contentLeft + px(computed.textIndent);
        answers[word] = {
          underline: computed.textDecorationLine.includes('underline'),
          // Drawn above its block, over what holds the block.
          background: gradient
            ? hex(gradient[1]!)
            : filled
              ? hex(computed.backgroundColor)
              : behind(labelled.parentElement),
          line: [Number.NaN, Number.NaN],
          x: (start - left) / pxPerPt,
          baseline: Number.NaN,
          size: parseFloat(computed.fontSize) / pxPerPt,
          family: computed.fontFamily
            .split(',')[0]!
            .trim()
            .replace(/^["']|["']$/g, ''),
          bold: Number(computed.fontWeight) >= 600,
          italic: computed.fontStyle === 'italic',
          colour: hex(computed.color),
        };
      }
      return answers;
    },
    { tokens: [...tokens], pxPerPt: PX_PER_PT },
  );
  const measured = new Map<string, Measured>();
  for (const token of tokens) {
    const each = found[token] as Omit<Measured, 'token' | 'page'> | undefined;
    if (!each) continue;
    measured.set(token, {
      ...each,
      token,
      page: 1,
      family: families[each.family] ?? each.family,
    });
  }
  return measured;
}

/** Every image in the document's text, in the order it stands, as the editor draws it. */
export async function editorImages(page: Page): Promise<MeasuredImage[]> {
  return page.evaluate((pxPerPt) => {
    const text = document.querySelector<HTMLElement>('section.aw-canvas')!;
    const origin = text.getBoundingClientRect();
    const style = getComputedStyle(text);
    const left = origin.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    return [...text.querySelectorAll('img')].map((image) => {
      const box = image.getBoundingClientRect();
      return {
        x: (box.left - left) / pxPerPt,
        foot: (box.bottom - origin.top) / pxPerPt,
        page: 1,
        width: box.width / pxPerPt,
        height: box.height / pxPerPt,
      };
    });
  }, PX_PER_PT);
}

/**
 * The rules on the edges of each cell holding one of `tokens`, as the editor draws them: half of each
 * the cell paints inside its edge as an inset shadow, read from its computed `box-shadow` - the other
 * half its neighbour's, or outside the table - along the cell's edge.
 */
export async function editorRules(
  page: Page,
  tokens: readonly string[],
  measured: ReadonlyMap<string, Measured>,
): Promise<Map<string, MeasuredRules>> {
  const found = await page.evaluate(
    ({ tokens, pxPerPt }) => {
      const text = document.querySelector<HTMLElement>('section.aw-canvas')!;
      const origin = text.getBoundingClientRect();
      const style = getComputedStyle(text);
      const left = origin.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
      const answers: Record<string, unknown> = {};
      const cells = [...text.querySelectorAll('td, th')];
      for (const token of tokens) {
        const cell = cells.find(
          (each) => (each.textContent ?? '').trim().split(/\s+/)[0] === token,
        );
        if (!cell) continue;
        const box = cell.getBoundingClientRect();
        const shadows = [
          ...getComputedStyle(cell).boxShadow.matchAll(
            /(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+inset/g,
          ),
        ].map((each) => ({ colour: each[1]!, x: Number(each[2]), y: Number(each[3]) }));
        // On the table's own edge, the rule's outer half is the table's shadow, as far as it is painted:
        // up to the edge of whatever clips it - the canvas, which scrolls sideways - and no further.
        const table = cell.closest('table')!;
        const frame = table.getBoundingClientRect();
        const spread = Number(
          /(-?[\d.]+)px\s*$/.exec(
            getComputedStyle(table)
              .boxShadow.replace(/\binset\b.*$/, '')
              .trim(),
          )?.[1] ?? 0,
        );
        let clip = { top: -Infinity, bottom: Infinity, left: -Infinity, right: Infinity };
        for (let at = table.parentElement; at; at = at.parentElement) {
          const computed = getComputedStyle(at);
          if (computed.overflowX === 'visible' && computed.overflowY === 'visible') continue;
          const edge = at.getBoundingClientRect();
          clip = {
            top: edge.top + parseFloat(computed.borderTopWidth),
            bottom: edge.bottom - parseFloat(computed.borderBottomWidth),
            left: edge.left + parseFloat(computed.borderLeftWidth),
            right: edge.right - parseFloat(computed.borderRightWidth),
          };
          break;
        }
        const outside = {
          top: Math.max(0, Math.min(spread, frame.top - clip.top)),
          bottom: Math.max(0, Math.min(spread, clip.bottom - frame.bottom)),
          left: Math.max(0, Math.min(spread, frame.left - clip.left)),
          right: Math.max(0, Math.min(spread, clip.right - frame.right)),
        };
        const onEdge = {
          top: Math.abs(box.top - frame.top) < 0.5,
          bottom: Math.abs(box.bottom - frame.bottom) < 0.5,
          left: Math.abs(box.left - frame.left) < 0.5,
          right: Math.abs(box.right - frame.right) < 0.5,
        };
        type Side = 'top' | 'bottom' | 'left' | 'right';
        const side = (name: Side, pick: (shadow: { x: number; y: number }) => number) => {
          const shadow = shadows.find((each) => pick(each) > 0.001);
          if (!shadow || /rgba\([^)]*,\s*0\)/.test(shadow.colour)) return null;
          // The half inside the cell, and the other half: its neighbour's, or the table's shadow.
          const other = onEdge[name] ? outside[name] : pick(shadow);
          return { width: (pick(shadow) + other) / pxPerPt, colour: shadow.colour };
        };
        answers[token] = {
          top: side('top', (each) => each.y),
          bottom: side('bottom', (each) => -each.y),
          left: side('left', (each) => each.x),
          right: side('right', (each) => -each.x),
          edges: {
            top: (box.top - origin.top) / pxPerPt,
            bottom: (box.bottom - origin.top) / pxPerPt,
            left: (box.left - left) / pxPerPt,
            right: (box.right - left) / pxPerPt,
          },
        };
      }
      return answers;
    },
    { tokens: [...tokens], pxPerPt: PX_PER_PT },
  );
  const hex = (rgb: string) => {
    const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).map(Number);
    return `#${[r, g, b]
      .map((each) =>
        Math.round(each ?? 0)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  };
  type Side = { width: number; colour: string } | null;
  const rules = new Map<string, MeasuredRules>();
  for (const token of tokens) {
    const each = found[token] as (Record<Edge, Side> & { edges: Record<Edge, number> }) | undefined;
    const baseline = measured.get(token)?.baseline;
    if (!each || baseline === undefined) continue;
    const at: Record<Edge, number> = {
      top: baseline - each.edges.top,
      bottom: each.edges.bottom - baseline,
      left: each.edges.left,
      right: each.edges.right,
    };
    const rule = (edge: Edge): MeasuredRule => {
      const side = each[edge];
      return side === null
        ? { at: at[edge], width: 0, colour: 'none' }
        : { at: at[edge], width: side.width, colour: hex(side.colour) };
    };
    rules.set(token, {
      top: rule('top'),
      bottom: rule('bottom'),
      left: rule('left'),
      right: rule('right'),
    });
  }
  return rules;
}

/**
 * The face an equation is drawn in, as the family the font files name: its `math` element's. The PDF's
 * is `pdfMathsFace`'s, in the kit.
 */
export async function editorMathsFace(
  page: Page,
  families: Readonly<Record<string, string>>,
): Promise<string | undefined> {
  const family = await page.evaluate(() => {
    // The identifier the equation draws, which is what the face sets: the `mi` of `x`.
    const maths = document.querySelector('section.aw-canvas math mi');
    return maths
      ? getComputedStyle(maths)
          .fontFamily.split(',')[0]!
          .trim()
          .replace(/^["']|["']$/g, '')
      : undefined;
  });
  return family === undefined ? undefined : (families[family] ?? family);
}

/**
 * Each list token's marker in the editor, drawn from its item's `::before` in the list's first column:
 * its words from its computed `content` (a counter resolved as the browser counts the list), its width
 * the width of those words in its own font, and where it ends from the column's edges and the marker's
 * own `justify-self` - so a marker set at the column's start where the page ends it there is found.
 */
export async function editorMarkers(
  page: Page,
  tokens: readonly string[],
  families: Readonly<Record<string, string>>,
): Promise<Map<string, MeasuredMarker>> {
  const found = await page.evaluate(
    ({ tokens, pxPerPt }) => {
      const text = document.querySelector<HTMLElement>('section.aw-canvas')!;
      const origin = text.getBoundingClientRect();
      const style = getComputedStyle(text);
      const left = origin.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
      const hex = (rgb: string) => {
        const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).map(Number);
        return `#${[r, g, b]
          .map((each) =>
            Math.round(each ?? 0)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')}`;
      };
      const answers: Record<string, unknown> = {};
      for (const token of tokens) {
        const block = [...text.querySelectorAll('li > [data-style]')].find(
          (each) => (each.textContent ?? '').trim().split(/\s+/)[0] === token,
        ) as HTMLElement | undefined;
        const item = block?.parentElement;
        if (!block || !item) continue;
        const marker = getComputedStyle(item, '::before');
        const list = getComputedStyle(item.parentElement!);
        // The words the marker draws: its bullet, or its number, from the counter the list keeps.
        const probe = document.createElement('span');
        probe.style.cssText =
          `position:absolute;visibility:hidden;white-space:pre;font-family:${marker.fontFamily};` +
          `font-size:${marker.fontSize};font-weight:${marker.fontWeight};font-style:${marker.fontStyle}`;
        item.append(probe);
        const index = [...item.parentElement!.children].indexOf(item);
        const start = Number(item.parentElement!.getAttribute('start') ?? 1);
        const words = /counter\(/.test(marker.content)
          ? `${start + index}.`
          : (JSON.parse(marker.content.replace(/^"(.*)"$/, '"$1"')) as string);
        probe.textContent = words;
        const wide = probe.getBoundingClientRect().width;
        probe.remove();
        // The second column starts where the item's block's margin box does; the first ends a gap before.
        const area =
          block.getBoundingClientRect().left - parseFloat(getComputedStyle(block).marginLeft);
        const columnEnd = area - parseFloat(list.columnGap);
        const columnStart = item.getBoundingClientRect().left;
        const end = marker.justifySelf === 'end' ? columnEnd : columnStart + wide;
        answers[token] = {
          end: (end - left) / pxPerPt,
          size: parseFloat(marker.fontSize) / pxPerPt,
          family: marker.fontFamily
            .split(',')[0]!
            .trim()
            .replace(/^["']|["']$/g, ''),
          bold: Number(marker.fontWeight) >= 600,
          italic: marker.fontStyle === 'italic',
          colour: hex(marker.color),
        };
      }
      return answers;
    },
    { tokens: [...tokens], pxPerPt: PX_PER_PT },
  );
  const markers = new Map<string, MeasuredMarker>();
  for (const token of tokens) {
    const each = found[token] as MeasuredMarker | undefined;
    if (each) markers.set(token, { ...each, family: families[each.family] ?? each.family });
  }
  return markers;
}
