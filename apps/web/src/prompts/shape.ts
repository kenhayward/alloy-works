import type { ContextSource, Prompt } from '@alloy-works/domain';
import { words } from '../words/words.js';

/** The purposes a prompt may be routed by, as the page names them; embedding writes no text. */
export const PURPOSES = {
  get drafting() {
    return words('prompts.drafting');
  },
  get chat() {
    return words('prompts.chat');
  },
  get summarising() {
    return words('prompts.summarising');
  },
} as const;
export type PromptPurpose = keyof typeof PURPOSES;

/** The parts of the outline a prompt may read, as the page names them. */
export const SCOPES = {
  get part() {
    return words('prompts.the-part-it-runs-on');
  },
  get section() {
    return words('prompts.the-parts-of-its-section');
  },
  get document() {
    return words('prompts.every-part-of-the-document');
  },
} as const;

/** One source as the page edits it: a list of parameters as the text typed. */
export type DraftSource =
  | Extract<ContextSource, { source: 'outline' | 'related' }>
  | { readonly source: 'field'; readonly field: string; readonly value: string }
  | { readonly source: 'parameters'; readonly names: string };

/** A prompt as the page edits it, before it is a prompt. */
export interface Draft {
  readonly title: string;
  readonly description: string;
  readonly instructions: string;
  readonly context: readonly DraftSource[];
  /** The component type it writes, or '' for any. */
  readonly componentType: string;
  readonly purpose: PromptPurpose;
  /** The models it accepts, one a line or separated by commas. */
  readonly accepts: string;
}

export const BLANK: Draft = {
  title: '',
  description: '',
  instructions: '',
  context: [{ source: 'outline', scope: 'part' }],
  componentType: '',
  purpose: 'drafting',
  accepts: '',
};

/** Words separated by commas, spaces or lines, each once, in the order typed. */
export const listOf = (text: string): string[] => [
  ...new Set(
    text
      .split(/[\s,]+/u)
      .map((each) => each.trim())
      .filter((each) => each !== ''),
  ),
];

export function draftOf(prompt: Prompt): Draft {
  return {
    title: prompt.title,
    description: prompt.description,
    instructions: prompt.instructions,
    context: prompt.context.map((each): DraftSource => {
      if (each.source === 'field') return { ...each, value: String(each.value) };
      if (each.source === 'parameters')
        return { source: 'parameters', names: each.names.join(', ') };
      return each;
    }),
    componentType: prompt.output.componentType ?? '',
    purpose: prompt.models.purpose,
    accepts: prompt.models.accepts.join('\n'),
  };
}

/** The prompt a draft is: checked by the service, never here. */
export function promptOf(draft: Draft): Prompt {
  return {
    schemaVersion: 1,
    title: draft.title.trim(),
    description: draft.description,
    instructions: draft.instructions,
    context: draft.context.map((each): ContextSource => {
      if (each.source === 'parameters') return { source: 'parameters', names: listOf(each.names) };
      if (each.source === 'field') return { ...each, value: each.value.trim() };
      return each;
    }),
    output: { componentType: draft.componentType === '' ? null : draft.componentType },
    models: { purpose: draft.purpose, accepts: listOf(draft.accepts) },
  };
}
