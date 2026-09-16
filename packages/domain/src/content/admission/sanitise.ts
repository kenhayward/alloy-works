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
      members.push([key, withoutExecutableStyle(member, report)]);
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
 */
function withoutExecutableStyle(presentation: unknown, report: ReportCollector): unknown {
  if (typeof presentation !== 'object' || presentation === null || Array.isArray(presentation)) {
    return presentation;
  }
  return Object.fromEntries(
    Object.entries(presentation).filter(([property, value]) => {
      if (!EXECUTABLE_STYLE.test(decodeCss(`${property}:${String(value)}`))) return true;
      report.add('sanitise', 'discarded', 'executableStyle', { detail: property });
      return false;
    }),
  );
}

/** CSS comments removed and escapes decoded, so a property reads as a browser would run it. */
function decodeCss(value: string): string {
  let withoutComments = '';
  let index = 0;
  for (;;) {
    const open = value.indexOf('/*', index);
    if (open === -1) {
      withoutComments += value.slice(index);
      break;
    }
    withoutComments += value.slice(index, open);
    const close = value.indexOf('*/', open + 2);
    if (close === -1) break;
    index = close + 2;
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
