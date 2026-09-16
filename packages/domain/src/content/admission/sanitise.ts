import { allowedLinkSchemes } from '../model/marks.js';

import { sanitiseMathml } from './mathml.js';
import type { ReportCollector } from './report.js';

/**
 * The first stage: what could run, embed or navigate is gone before anything else touches the
 * content (CNT-130), so no later stage can carry it further or rewrite it into something that passes.
 *
 * It walks the reader's output as plain JSON rather than as the model, because what it removes has
 * no place in the model. The vocabulary a reader uses for it is named in `admit.ts`: a `script` or
 * `embeddedObject` node anywhere a node can stand, a `handlers` member on any node, a `hyperlink`
 * mark with any target, a `presentation` member on any node, and an equation's MathML as it arrived.
 *
 * Nothing is mutated. The reader's output is read and a new value built, so a caller holding the
 * original still holds what arrived.
 */
export function sanitise(candidate: unknown, report: ReportCollector): unknown {
  const tally = { equationsRewritten: 0 };
  const result = visit(candidate, report, tally);
  if (tally.equationsRewritten > 0) {
    report.add('sanitise', 'rewritten', 'equation', { count: tally.equationsRewritten });
  }
  return result === REMOVE ? undefined : result;
}

const REMOVE = Symbol('remove');

/**
 * Whether the URL parser strips or ignores part of the target - a control character, a space, a tab
 * or a line break - so that the target says something other than what a browser reads.
 */
function readsDifferently(href: string): boolean {
  for (const character of href) {
    const code = character.codePointAt(0)!;
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

const EXECUTABLE_STYLE =
  /expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:|url\s*\(|@import/i;

function visit(
  value: unknown,
  report: ReportCollector,
  tally: { equationsRewritten: number },
): unknown {
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    for (const member of value) {
      const next = visit(member, report, tally);
      if (next !== REMOVE) kept.push(next);
    }
    return kept;
  }
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;

  if (record.type === 'script' || record.type === 'embeddedObject') {
    report.add('sanitise', 'discarded', record.type, detail(record.name));
    return REMOVE;
  }

  /** Members this stage rewrote, which replace what arrived. */
  const replaced = new Map<string, unknown>();

  if (record.type === 'hyperlink') {
    const href = record.href;
    let parsed: URL | undefined;
    try {
      parsed = typeof href === 'string' ? new URL(href) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!parsed || !(allowedLinkSchemes as readonly string[]).includes(parsed.protocol)) {
      report.add('sanitise', 'discarded', 'hyperlink', detail(href));
      return REMOVE;
    }
    if (typeof href === 'string' && readsDifferently(href)) {
      report.add('sanitise', 'rewritten', 'hyperlink', { detail: href });
      replaced.set('href', parsed.href);
    }
  }

  if (record.type === 'equation' && typeof record.mathml === 'string') {
    const result = sanitiseMathml(record.mathml);
    if (!result.ok) {
      report.add('sanitise', 'discarded', 'equation', { detail: result.failure });
      return REMOVE;
    }
    for (const finding of result.findings) {
      report.add('sanitise', 'discarded', finding.subject, { detail: finding.detail });
    }
    if (result.mathml !== record.mathml) tally.equationsRewritten += 1;
    replaced.set('mathml', result.mathml);
  }

  // Built as entries rather than by assignment: `out[key] = value` calls the `__proto__` setter for
  // a member of that name, and the member would vanish without a report entry.
  const members: [string, unknown][] = [];
  for (const [key, member] of Object.entries(record)) {
    if (replaced.has(key)) {
      members.push([key, replaced.get(key)]);
      continue;
    }
    if (key === 'handlers') {
      const names = Array.isArray(member) ? member : [member];
      for (const name of names) report.add('sanitise', 'discarded', 'eventHandler', detail(name));
      continue;
    }
    if (key === 'presentation') {
      const cleaned = withoutExecutableStyle(member, report);
      if (cleaned !== REMOVE) members.push([key, cleaned]);
      continue;
    }
    const next = visit(member, report, tally);
    if (next !== REMOVE) members.push([key, next]);
  }
  return Object.fromEntries(members);
}

/**
 * Formatting is dropped whole by normalise, and the model has no member it could survive into - so a
 * style that runs code cannot be stored whether or not this finds it. This exists so the report says
 * what it was: a script dressed as formatting is a script, and reporting it as a lost typeface would
 * tell the author nothing happened.
 *
 * `presentation` is meant to be a flat record of strings, but nothing upstream of this stage
 * enforces that shape - it is untrusted, exactly like everything else the reader handed over. A
 * property's own value is searched wherever it hides a string, not just at `String(value)`, so a
 * nested object cannot hide an attack behind `[object Object]`. When `presentation` itself is not
 * that flat record - a bare string, an array, anything else - there is no property name to blame it
 * on, so the whole member is removed if it hides an attack anywhere, with the offending text itself
 * as `detail`.
 */
function withoutExecutableStyle(presentation: unknown, report: ReportCollector): unknown {
  if (typeof presentation === 'object' && presentation !== null && !Array.isArray(presentation)) {
    return Object.fromEntries(
      Object.entries(presentation).filter(([property, value]) => {
        if (!hasExecutableStyle(property, value)) return true;
        report.add('sanitise', 'discarded', 'executableStyle', { detail: property });
        return false;
      }),
    );
  }
  const offending = findExecutableStyle(presentation);
  if (offending === undefined) return presentation;
  report.add('sanitise', 'discarded', 'executableStyle', { detail: offending });
  return REMOVE;
}

/**
 * Every string reachable inside a value, gathered depth-first. Bounded by the same assumption the
 * rest of this module's walk relies on: `exceedsLimits` has already run over the whole candidate
 * before sanitise sees any of it (decision 6), so nothing here meets a depth nobody sized.
 */
function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    into.push(value);
  } else if (Array.isArray(value)) {
    for (const member of value) collectStrings(member, into);
  } else if (typeof value === 'object' && value !== null) {
    for (const member of Object.values(value)) collectStrings(member, into);
  }
}

/**
 * Whether a presentation property's value - however deeply it is nested - holds a string that would
 * run code or fetch a resource. Each string found is joined to the property name before matching, so
 * a property literally named `behavior` is still caught the way a flat `{ behavior: 'url(...)' }`
 * always was.
 */
function hasExecutableStyle(property: string, value: unknown): boolean {
  const strings: string[] = [];
  collectStrings(value, strings);
  return strings.some((text) => EXECUTABLE_STYLE.test(decodeCss(`${property}:${text}`)));
}

/**
 * The first string reachable inside a value that would run code or fetch a resource, for a
 * `presentation` that is not a record of properties - so there is no property name to join it to.
 */
function findExecutableStyle(value: unknown): string | undefined {
  const strings: string[] = [];
  collectStrings(value, strings);
  return strings.find((text) => EXECUTABLE_STYLE.test(decodeCss(text)));
}

/**
 * CSS comments removed and escapes decoded, so a property reads as a browser would run it. A
 * `/* ... *\/` inside a quoted string is not a comment - a browser keeps it as text - so this tracks
 * whether it is reading inside a single- or double-quoted string, honouring a backslash escape, and
 * only treats `/*` as a comment opening outside one. Failing to recognise a real quoted string only
 * leaves more text for the caller to match against, never less: it cannot hide an attack, only flag
 * something extra.
 */
function decodeCss(value: string): string {
  let withoutComments = '';
  let index = 0;
  let quote: '"' | "'" | undefined;
  while (index < value.length) {
    const character = value[index]!;
    if (quote !== undefined) {
      if (character === '\\' && index + 1 < value.length) {
        withoutComments += character + value[index + 1];
        index += 2;
        continue;
      }
      withoutComments += character;
      if (character === quote) quote = undefined;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      withoutComments += character;
      index += 1;
      continue;
    }
    if (character === '/' && value[index + 1] === '*') {
      const close = value.indexOf('*/', index + 2);
      if (close === -1) break;
      index = close + 2;
      continue;
    }
    withoutComments += character;
    index += 1;
  }
  return withoutComments
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/\\(.)/gs, '$1');
}

function detail(value: unknown): { detail?: string } {
  return typeof value === 'string' ? { detail: value } : {};
}
