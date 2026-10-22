import { isRecord } from '../data/shapes.js';

/** A term's label in one language (terms.md, "The term"). */
export interface Label {
  readonly language: string;
  readonly preferred: string;
  readonly alternatives: readonly string[];
  readonly abbreviation?: string;
}

/** A term version as the service answers it. */
export interface Term {
  readonly schemaVersion: 1;
  readonly base: string;
  readonly labels: readonly Label[];
  readonly definition: readonly { readonly language: string; readonly text: string }[];
  readonly broader: readonly string[];
  readonly narrower: readonly string[];
  readonly related: readonly string[];
  readonly replacedBy?: string;
}

/** A term as its space lists it. */
export interface Summary {
  readonly id: string;
  readonly label: string;
  readonly abbreviation: string | null;
  readonly state: { readonly key: string; readonly name: string } | null;
}

export const isSummary = (value: unknown): value is Summary =>
  isRecord(value) && typeof value.id === 'string' && typeof value.label === 'string';

/** Its label in its base language. */
export const baseLabel = (term: Term): Label =>
  term.labels.find((each) => each.language === term.base) ?? term.labels[0]!;

/** A plain message from a refusal, or the fallback. */
export const said = (error: unknown, fallback: string): string =>
  isRecord(error) && typeof error.message === 'string' ? error.message : fallback;

/** Saves `text` as a file without navigating the page, as a download never does. */
export function saveText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
