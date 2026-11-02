import { declaredLanguageOf } from '../interface/declared-languages.js';

/** The language and direction delivered content is written in (ct-studio-sink.md). */
export interface LanguageKept {
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
}

/** What `und` says: that nothing has been named, so it gives way to what has. */
const UNDETERMINED = 'und';

const directionOf = (language: string): 'ltr' | 'rtl' =>
  declaredLanguageOf(language)?.direction ?? 'ltr';

/**
 * What delivered content is in. What it holds already stays, a person's choice surviving a delivery,
 * unless nothing was named; then, or for what is new, the first of `named` naming a language.
 */
export function languageKept(
  held: LanguageKept | null,
  ...named: readonly (string | null | undefined)[]
): LanguageKept {
  if (held !== null && held.language !== UNDETERMINED) return held;
  const language = named.find(
    (each): each is string => typeof each === 'string' && each !== UNDETERMINED,
  );
  if (language === undefined)
    return { language: UNDETERMINED, direction: held?.direction ?? 'ltr' };
  return { language, direction: directionOf(language) };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) && a.length === b.length && a.every((each, index) => same(each, b[index]))
    );
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((key) => key in b && same(a[key], b[key]))
  );
}

interface Pin {
  readonly from: string;
  readonly to: string;
}

/** A root's content with its language and direction gone, and each pin's version given to `pin`. */
function withoutLanguage(root: unknown, pin: (version: string) => string): unknown {
  if (!isObject(root)) return root;
  const { language: dropped, direction: alsoDropped, ...rest } = root;
  void dropped;
  void alsoDropped;
  const nodes = (list: unknown): unknown =>
    Array.isArray(list)
      ? list.map((node: unknown) => {
          if (!isObject(node)) return node;
          const mode = node['mode'];
          const version = isObject(mode) ? mode['version'] : undefined;
          return {
            ...node,
            ...(typeof version === 'string'
              ? { mode: { ...(mode as object), version: pin(version) } }
              : {}),
            ...('children' in node ? { children: nodes(node['children']) } : {}),
          };
        })
      : list;
  return 'nodes' in rest ? { ...rest, nodes: nodes(rest['nodes']) } : rest;
}

/**
 * Whether two versions' substance is the same but for the language and direction of their content, and
 * the pins that moved to answer it: a language change is no edit to a delivery (L5). `null` where
 * anything else differs. Each pin moved still has to be shown to differ only in language in turn.
 */
export function apartFromLanguage(
  was: { readonly content: unknown; readonly [member: string]: unknown },
  now: { readonly content: unknown; readonly [member: string]: unknown },
): readonly Pin[] | null {
  const seen: string[] = [];
  const before = withoutLanguage(was.content, (version) => {
    seen.push(version);
    return '';
  });
  const moved: Pin[] = [];
  let at = 0;
  const after = withoutLanguage(now.content, (version) => {
    const from = seen[at];
    at += 1;
    if (from !== undefined && from !== version) moved.push({ from, to: version });
    return '';
  });
  if (at !== seen.length || !same(before, after)) return null;
  const { content: droppedWas, ...restWas } = was;
  const { content: droppedNow, ...restNow } = now;
  void droppedWas;
  void droppedNow;
  return same(restWas, restNow) ? moved : null;
}
