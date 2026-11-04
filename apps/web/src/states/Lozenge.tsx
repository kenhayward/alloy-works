import type { HTMLAttributes, ReactNode } from 'react';

import { Icon } from '../editor/Icon.js';
import { words } from '../words/words.js';
import styles from './States.module.css';

/** What a state means, and nothing else (docs/interface/lifecycle-states.md, ADR-0081). */
export type LozengeTone = 'neutral' | 'info' | 'ok' | 'warn' | 'muted' | 'danger';

/**
 * Every state of content has a kind here, a row in the guide and a word under `states.*`, held
 * together by `lozenge-guard.test.ts`. `state` is a state a tenant declares, in the tenant's words.
 */
const TONES = {
  draft: 'neutral',
  beingEdited: 'info',
  returned: 'warn',
  inReview: 'info',
  inApproval: 'info',
  approved: 'ok',
  effective: 'ok',
  published: 'ok',
  changedSince: 'warn',
  notApproved: 'warn',
  pastReview: 'warn',
  onHold: 'warn',
  released: 'muted',
  superseded: 'muted',
  current: 'neutral',
  archived: 'muted',
  retired: 'muted',
  neverPublished: 'neutral',
  notYoursToRead: 'neutral',
  diverged: 'neutral',
  pending: 'info',
  accepted: 'ok',
  rejected: 'warn',
  withdrawn: 'muted',
  resolved: 'muted',
  notStarted: 'neutral',
  inProgress: 'info',
  complete: 'ok',
  closed: 'muted',
  untranslated: 'warn',
  machineDrafted: 'info',
  inTranslation: 'info',
  translated: 'neutral',
  outOfDate: 'warn',
  neverResolved: 'neutral',
  changedSinceResolved: 'warn',
  failed: 'danger',
  revisionWaiting: 'warn',
  definitionChanged: 'warn',
  revisedByHand: 'neutral',
  changedSincePublished: 'warn',
  holding: 'ok',
  retracted: 'danger',
  corrected: 'warn',
  state: 'neutral',
} as const satisfies Record<string, LozengeTone>;

export type LozengeKind = keyof typeof TONES;
export type LozengeSize = 'default' | 'small' | 'dot';

export const LOZENGE_KINDS = Object.keys(TONES) as readonly LozengeKind[];
export const toneOf = (kind: LozengeKind): LozengeTone => TONES[kind];

/** One state, one wording: the only place the `states.*` keys are read. */
const WORDS: Readonly<Record<Exclude<LozengeKind, 'state'>, () => string>> = {
  draft: () => words('states.draft'),
  beingEdited: () => words('states.being-edited'),
  returned: () => words('states.returned'),
  inReview: () => words('states.in-review'),
  inApproval: () => words('states.in-approval'),
  approved: () => words('states.approved'),
  effective: () => words('states.effective'),
  published: () => words('states.published'),
  changedSince: () => words('states.changed-since'),
  notApproved: () => words('states.not-approved'),
  pastReview: () => words('states.past-review'),
  onHold: () => words('states.on-hold'),
  released: () => words('states.released'),
  superseded: () => words('states.superseded'),
  current: () => words('states.current'),
  archived: () => words('states.archived'),
  retired: () => words('states.retired'),
  neverPublished: () => words('states.never-published'),
  notYoursToRead: () => words('states.not-yours-to-read'),
  diverged: () => words('states.diverged'),
  pending: () => words('states.pending'),
  accepted: () => words('states.accepted'),
  rejected: () => words('states.rejected'),
  withdrawn: () => words('states.withdrawn'),
  resolved: () => words('states.resolved'),
  notStarted: () => words('states.not-started'),
  inProgress: () => words('states.in-progress'),
  complete: () => words('states.complete'),
  closed: () => words('states.closed'),
  untranslated: () => words('states.untranslated'),
  machineDrafted: () => words('states.machine-drafted'),
  inTranslation: () => words('states.in-translation'),
  translated: () => words('states.translated'),
  outOfDate: () => words('states.out-of-date'),
  neverResolved: () => words('states.never-resolved'),
  changedSinceResolved: () => words('states.changed-since-resolved'),
  failed: () => words('states.failed'),
  revisionWaiting: () => words('states.revision-waiting'),
  definitionChanged: () => words('states.definition-changed'),
  revisedByHand: () => words('states.revised-by-hand'),
  changedSincePublished: () => words('states.changed-since-published'),
  holding: () => words('states.holding'),
  retracted: () => words('states.retracted'),
  corrected: () => words('states.corrected'),
};

/**
 * A state's words where it is named rather than shown: a filter's label, a column's heading. The guard
 * lists who may call this, each with its reason, so a state is never shown through it.
 */
export const stateWord = (kind: Exclude<LozengeKind, 'state'>): string => WORDS[kind]();

const ICON_SIZES: Readonly<Record<LozengeSize, number>> = { default: 12, small: 10, dot: 11 };

/**
 * **The one way to show a state** (ADR-0081; LIF-005, LIF-078): an icon and words, in the tone its
 * kind means. The words are the catalogue's, or what is given: a tenant's name with `content`, or the
 * facts a state is shown with. Text, not a control: a click belongs to the row or link around it.
 */
export function Lozenge({
  kind,
  size = 'default',
  content,
  className,
  children,
  ...rest
}: {
  kind: LozengeKind;
  size?: LozengeSize;
  /** Its words are the tenant's, a workflow's state name, not the interface's. */
  content?: boolean;
  className?: string | undefined;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, 'className' | 'children' | 'content'>) {
  const said = children ?? (kind === 'state' ? '' : WORDS[kind]());
  const named = typeof said === 'string' ? said : undefined;
  return (
    <span
      {...rest}
      className={`${styles['lozenge']}${className ? ` ${className}` : ''}`}
      data-lozenge=""
      data-kind={kind}
      data-tone={TONES[kind]}
      data-size={size}
      {...(content ? { 'data-content': '' } : {})}
      {...(size === 'dot' ? { role: 'img', 'aria-label': named, title: named } : {})}
    >
      <Icon name={`state:${kind}`} size={ICON_SIZES[size]} />
      {size === 'dot' ? null : said}
    </span>
  );
}

/** The seed workflow's states, and the keys a tenant may declare for the same meaning, by key. */
const SEEDED: Readonly<Record<string, LozengeKind>> = {
  draft: 'draft',
  in_review: 'inReview',
  approved: 'approved',
  returned: 'returned',
  in_approval: 'inApproval',
};

/** The kind a state's key is drawn as; undefined for one only a tenant's words can name. */
export const seededKind = (key: string): LozengeKind | undefined =>
  Object.hasOwn(SEEDED, key) ? SEEDED[key] : undefined;

/**
 * A workflow state, by the name its workflow gives it (LIF-005): the seed's in their own tones, any
 * other a tenant declares a neutral fact.
 */
export function StateLozenge({
  state,
  size,
}: {
  state: { readonly key: string; readonly name: string };
  size?: LozengeSize;
}) {
  return (
    <Lozenge kind={seededKind(state.key) ?? 'state'} content {...(size ? { size } : {})}>
      {state.name}
    </Lozenge>
  );
}
