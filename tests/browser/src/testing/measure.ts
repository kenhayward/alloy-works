import type { Page } from 'playwright-core';
import type { Paint, PaintedText } from './pdf.js';

/**
 * **What a token measures at**, in the editor and in the PDF alike (the W13 plan's W13.4, steps 4 and
 * 5; ADR-0014's method): where its first letter starts, across from the text's own start, and its
 * baseline, down from the top of what holds it, both in points; the size it is set at, in points; the
 * face, weight and posture it is drawn in; and its colour.
 */
export interface Measured {
  readonly token: string;
  /** Points across from where the measure starts. */
  readonly x: number;
  /** Points down to its baseline: from the canvas's top in the editor, from the page's in the PDF. */
  readonly baseline: number;
  /** The PDF's page, from 1; the editor has one, 1. */
  readonly page: number;
  readonly size: number;
  /** The family, as the font files name it: `Liberation Serif`. */
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  /** `#rrggbb`. */
  readonly colour: string;
  /** Whether it is drawn underlined. */
  readonly underline: boolean;
  /** The colour behind it: a fill, or where there is none the paper, as `#rrggbb`. */
  readonly background: string;
  /** Where the line it stands in starts and ends, in points across from where the measure starts. */
  readonly line: readonly [number, number];
}

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
          const gradient = /linear-gradient\((rgba?\([^)]*\))/.exec(computed.backgroundImage);
          if (gradient) return hex(gradient[1]!);
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
      // stand: only how it is set is read, from the label's own computed style.
      for (const word of wanted) {
        const labelled = text.querySelector(`pre[data-language="${word}"]`);
        if (!labelled) continue;
        const computed = getComputedStyle(labelled, '::before');
        const gradient = /linear-gradient\((rgba?\([^)]*\))/.exec(computed.backgroundImage);
        answers[word] = {
          underline: computed.textDecorationLine.includes('underline'),
          // Drawn above its block, over what holds the block.
          background: gradient ? hex(gradient[1]!) : behind(labelled.parentElement),
          line: [Number.NaN, Number.NaN],
          x: Number.NaN,
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

/** `LiberationSerif-BoldItalic` as its family, weight and posture. */
function faceOf(face: string): { family: string; bold: boolean; italic: boolean } {
  const [name = '', style = ''] = face.split('-');
  return {
    family: name.replace(/([a-z])([A-Z])/g, '$1 $2'),
    bold: /Bold/.test(style),
    italic: /Italic|Oblique/.test(style),
  };
}

/**
 * Each token as the PDF paints it (step 5): the last time it is painted outside an artifact - after the
 * contents and the lists, which repeat a heading's or a caption's words, and never a running head -
 * its start across from the page's left margin `margin`, its baseline down from the page's top, and
 * its size, face and fill.
 */
export function measurePdf(
  paint: Paint,
  tokens: readonly string[],
  margin: number,
): Map<string, Measured> {
  const measured = new Map<string, Measured>();
  const runs = paint.texts.filter((run: PaintedText) => !run.artifact);
  for (const token of tokens) {
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      const run = runs[index]!;
      const match = [...run.text.matchAll(/\S+/g)].find((word) => word[0] === token);
      if (!match) continue;
      const height = paint.pages[run.page - 1]!.height;
      const x = run.x + (run.offsets[match.index] ?? 0);
      const onLine = runs.filter(
        (each) => each.page === run.page && Math.abs(each.y - run.y) < 0.25 && each.width > 0,
      );
      // An underline is a rule drawn just beneath the baseline across the run: filled or stroked.
      const beneath = (box: readonly number[]) =>
        box[1]! < run.y && box[3]! > run.y - run.size * 0.3 && box[0]! <= x + 1 && box[2]! >= x + 1;
      const underline =
        paint.fills.some(
          (fill) => fill.page === run.page && beneath(fill.box) && fill.box[3]! - fill.box[1]! < 3,
        ) ||
        paint.strokes.some(
          (stroke) =>
            stroke.page === run.page && beneath(stroke.box) && stroke.box[3]! - stroke.box[1]! < 3,
        );
      // The smallest fill behind the token's first letter, taller than a rule.
      const fills = paint.fills
        .filter(
          (fill) =>
            fill.page === run.page &&
            fill.box[0] <= x + 0.5 &&
            fill.box[2] >= x + 0.5 &&
            fill.box[1] <= run.y + 1 &&
            fill.box[3] >= run.y + 1 &&
            fill.box[3] - fill.box[1] > 3,
        )
        .sort(
          (a, b) =>
            (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) -
            (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]),
        );
      measured.set(token, {
        token,
        x: x - margin,
        baseline: height - run.y,
        page: run.page,
        size: run.size,
        ...faceOf(run.face),
        colour: run.fill,
        underline,
        background: fills[0]?.fill ?? 'none',
        line: [
          Math.min(...onLine.map((each) => each.x)) - margin,
          Math.max(...onLine.map((each) => each.x + each.width)) - margin,
        ],
      });
      break;
    }
  }
  return measured;
}

/** An image as it is drawn: where it starts across the measure, its foot and its size, in points. */
export interface MeasuredImage {
  readonly x: number;
  /** Down to its foot: from the canvas's top in the editor, from the page's in the PDF. */
  readonly foot: number;
  readonly page: number;
  readonly width: number;
  readonly height: number;
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

/** Every image the PDF paints, in the order it paints them, across from the left margin `margin`. */
export function pdfImages(paint: Paint, margin: number): MeasuredImage[] {
  return paint.images.map((image) => ({
    x: image.box[0] - margin,
    foot: paint.pages[image.page - 1]!.height - image.box[1],
    page: image.page,
    width: image.box[2] - image.box[0],
    height: image.box[3] - image.box[1],
  }));
}

/**
 * A rule on one edge of a cell: where the edge runs - for the top and the bottom, how far above or
 * below the cell's token's baseline; for the left and the right, how far across from where the measure
 * starts - how thick the rule is drawn, and its colour; `none` and nought thick where there is none.
 */
export interface MeasuredRule {
  readonly at: number;
  readonly width: number;
  readonly colour: string;
}

export type Edge = 'top' | 'bottom' | 'left' | 'right';
export const EDGES: readonly Edge[] = ['top', 'bottom', 'left', 'right'];
export type MeasuredRules = Readonly<Record<Edge, MeasuredRule>>;

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
        const side = (pick: (shadow: { x: number; y: number }) => number) => {
          const shadow = shadows.find((each) => pick(each) > 0.001);
          return !shadow || /rgba\([^)]*,\s*0\)/.test(shadow.colour)
            ? null
            : { width: (2 * pick(shadow)) / pxPerPt, colour: shadow.colour };
        };
        answers[token] = {
          top: side((each) => each.y),
          bottom: side((each) => -each.y),
          left: side((each) => each.x),
          right: side((each) => -each.x),
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
 * The rules the PDF strokes about each cell holding one of `tokens`: along each edge, the stroke
 * running past the token that lies within a point and a half of where the editor's edge is - the same
 * distance from the baseline, the same distance across the measure - measured as the editor's are.
 */
export function pdfRules(
  paint: Paint,
  tokens: readonly string[],
  measured: ReadonlyMap<string, Measured>,
  editor: ReadonlyMap<string, MeasuredRules>,
  margin: number,
): Map<string, MeasuredRules> {
  const rules = new Map<string, MeasuredRules>();
  for (const token of tokens) {
    const at = measured.get(token);
    const near = editor.get(token);
    if (!at || !near) continue;
    const y = paint.pages[at.page - 1]!.height - at.baseline;
    const x = at.x + margin;
    const strokes = paint.strokes.filter((each) => each.page === at.page);
    const along = (edge: Edge, want: number): MeasuredRule => {
      const across = edge === 'top' || edge === 'bottom';
      const found = strokes
        .filter((each) =>
          across
            ? each.box[2] - each.box[0] > each.box[3] - each.box[1] &&
              each.box[0] <= x + 1 &&
              each.box[2] >= x + 1
            : each.box[3] - each.box[1] > each.box[2] - each.box[0] &&
              each.box[1] <= y &&
              each.box[3] >= y,
        )
        .map((each) => ({
          each,
          centre: across ? (each.box[1] + each.box[3]) / 2 : (each.box[0] + each.box[2]) / 2,
        }))
        .filter(({ centre }) => Math.abs(centre - want) <= 1.5)
        .sort((a, b) => Math.abs(a.centre - want) - Math.abs(b.centre - want))[0];
      const distance = (centre: number) =>
        edge === 'top' ? centre - y : edge === 'bottom' ? y - centre : centre - margin;
      return found
        ? { at: distance(found.centre), width: found.each.width, colour: found.each.stroke }
        : { at: near[edge].at, width: 0, colour: 'none' };
    };
    rules.set(token, {
      top: along('top', y + near.top.at),
      bottom: along('bottom', y - near.bottom.at),
      left: along('left', margin + near.left.at),
      right: along('right', margin + near.right.at),
    });
  }
  return rules;
}
