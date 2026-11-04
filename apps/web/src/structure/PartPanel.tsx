import type { FieldView } from '@alloy-works/api-client';
import {
  canonicaliseTitle,
  hasText,
  type IncomingReference,
  type OutlineViewNode,
  type OutlineOperation,
  type SectionViewNode,
} from '@alloy-works/domain';
import { mountTitleEditor, titleToEditor, type TitleEditor } from '@alloy-works/editor';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';

// The title field's editor, and the equations in it, drawn as the component editor draws them.

import { Icon } from '../editor/Icon.js';
import styles from './OutlinePanel.module.css';

import { nodeName, titleText, trimTitle, type Names } from './tree.js';
import { StateLozenge } from '../states/Lozenge.js';
import { HeldFields } from '../metadata/HeldFields.js';
import { Segmented } from '../parts/Segmented.js';
import { words as say } from '../words/words.js';
import { Chip } from '../parts/Chip.js';
import { ConfirmDialog } from '../parts/ConfirmDialog.js';
import { IconButton } from '../parts/IconButton.js';
import { keep, kept } from '../layouts/PaneWidth.js';
import { FieldKindIcons } from '../metadata/FieldsForm.js';
import { Lozenge } from '../states/Lozenge.js';
import { componentsBeneath, sameNumber, typedNumber, withoutTypedNumber } from './partSummary.js';
import part from './PartPanel.module.css';
import type {
  Answered,
  ComponentChoice,
  EquationRequest,
  RetitleAnswer,
  RetitleOperation,
  Title,
} from './OutlinePanel.js';

const PAGE_BREAKS = [
  {
    value: 'none',
    icon: 'Flows on',
    get label() {
      return say('document.wherever-it-falls');
    },
    get short() {
      return say('document.flows-on');
    },
  },
  {
    value: 'page',
    icon: 'New page',
    get label() {
      return say('document.a-new-page');
    },
    get short() {
      return say('document.new-page');
    },
  },
  {
    value: 'recto',
    icon: 'Right page',
    get label() {
      return say('document.a-new-right-hand-page');
    },
    get short() {
      return say('document.right-page');
    },
  },
] as const;

/** The three matters a top-level node may be in, in the order a publication prints them (STR-064). */
const MATTERS = [
  {
    value: 'front',
    get label() {
      return say('document.front-matter');
    },
    get short() {
      return say('document.front');
    },
  },
  {
    value: 'body',
    get label() {
      return say('document.body');
    },
    get short() {
      return say('document.body');
    },
  },
  {
    value: 'appendix',
    get label() {
      return say('document.appendix');
    },
    get short() {
      return say('document.appendix');
    },
  },
] as const;

function isPageBreak(value: string): value is OutlineViewNode['pageBreak'] {
  return PAGE_BREAKS.some((each) => each.value === value);
}

function isMatter(value: string): value is OutlineViewNode['matter'] {
  return MATTERS.some((each) => each.value === value);
}

const IRREVERSIBLE = (): string => say('document.this-cannot-be-undone-and');

/**
 * Whether a node, or anything beneath it, is a section or a component the template requires (TPL-029,
 * TPL-044): each carries the key it was made for as its `origin`.
 */
export function holdsRequired(
  node: OutlineViewNode | undefined,
  required: readonly string[],
): boolean {
  if (!node || required.length === 0) return false;
  if (node.origin !== undefined && required.includes(node.origin)) {
    return true;
  }
  return node.children.some((child) => holdsRequired(child, required));
}

/** The components a node places, once each in outline order: its own, or every one beneath it. */
export function placedBy(node: OutlineViewNode): string[] {
  const own = node.type === 'reference' && node.component !== null ? [node.component] : [];
  return [...new Set([...own, ...node.children.flatMap(placedBy)])];
}

/**
 * Removing a part asks first, in the one confirmation every removal uses (ADR-0049, decision 6): what
 * goes, what stays, what refers to it, and a reason where the template requires one. A removal has no
 * inverse (`tree.ts`, `inverseOf`) and empties the undo stack, so the sentence says both.
 */
export function ConfirmRemoval({
  node,
  names,
  referencedBy,
  needsReason,
  onRemove,
  onKeep,
}: {
  node: OutlineViewNode | undefined;
  /** It takes a section or a component the template requires: removed only with a reason. */
  needsReason: boolean;
  names: Names;
  /**
   * What refers to the node from elsewhere (STR-074): warned of, never refused; or not known yet, or
   * not known at all, which is said rather than taken for nothing.
   */
  referencedBy:
    { readonly count: number; readonly list: ReactNode } | 'checking' | 'unknown' | null;
  onRemove: (reason?: string) => void;
  onKeep: () => void;
}) {
  const [reason, setReason] = useState('');
  if (!node) return null;
  const name = nodeName(node, names);
  const count = componentsBeneath(node);
  return (
    <ConfirmDialog
      question={
        node.children.length > 0
          ? say('document.remove-and-everything-beneath-it', { name })
          : say('document.remove-3', { name })
      }
      sentence={IRREVERSIBLE()}
      keep={say('document.keep')}
      act={say('document.remove-2')}
      waiting={needsReason && reason.trim() === ''}
      onKeep={onKeep}
      onAct={async () => onRemove(needsReason ? reason.trim() : undefined)}
      detail={
        <>
          <ul className={part['facts']}>
            {node.type === 'reference' ? (
              <li>{say('document.the-component-stays-in-the-library')}</li>
            ) : (
              count > 0 && <li>{say('document.it-places-components', { count })}</li>
            )}
            {referencedBy === 'checking' && (
              <li>{say('document.whether-anything-else-in-this')}</li>
            )}
            {referencedBy === 'unknown' && (
              <li>{say('document.whether-anything-else-in-this-2')}</li>
            )}
            {referencedBy !== null && typeof referencedBy !== 'string' && (
              <li>
                {say('document.referenced-elsewhere-in-this-document', {
                  count: referencedBy.count,
                })}
              </li>
            )}
          </ul>
          {referencedBy !== null && typeof referencedBy !== 'string' && referencedBy.list}
          {needsReason && (
            <label className={part['reason']}>
              {say('document.why-it-is-removed')}
              <textarea
                value={reason}
                maxLength={2000}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          )}
        </>
      }
    />
  );
}

/** The places in the document that refer to a node (STR-074): a row each, going there. */
export function ReferencedBy({
  references,
  withheld,
  nameOf,
  linkOf,
  onGo,
}: {
  references: readonly IncomingReference[] | 'checking' | 'unknown';
  /** The outline holds an occurrence the reader may not read, so "nothing" is only what they can read. */
  withheld: boolean;
  nameOf: (node: string) => string;
  linkOf: ((node: string) => string) | undefined;
  onGo: (node: string) => void;
}) {
  const label = useId();
  const counts = referringCounts(references);
  return (
    <div className={part['links']}>
      <div className={part['linksHead']}>
        <span id={label}>{say('document.referenced-by')}</span>
        {counts !== null && <span>{counts.size}</span>}
      </div>
      {references === 'checking' ? (
        <p className={part['said']}>{say('document.checking')}</p>
      ) : references === 'unknown' ? (
        <p className={part['said']}>{say('document.could-not-be-checked')}</p>
      ) : counts?.size === 0 ? (
        <p className={part['said']}>
          {withheld
            ? say('document.nothing-you-can-read-in')
            : say('document.nothing-else-in-this-document')}
        </p>
      ) : (
        <ul aria-labelledby={label} className={part['rows']}>
          {[...(counts ?? [])].map(([from, count]) => (
            <li key={from}>
              <a
                className={part['refRow']}
                href={linkOf?.(from) ?? '#'}
                aria-label={say('document.referenced-from', { name: nameOf(from), count })}
                title={nameOf(from)}
                onClick={(event) => {
                  event.preventDefault();
                  onGo(from);
                }}
              >
                <Icon name="Link" size={14} />
                <span className={part['rowName']}>{nameOf(from)}</span>
                <span className={part['rowFact']}>
                  {say('document.count-references', { count })}
                </span>
                <Icon name="Go to" size={12} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How many references each place holds, or null where that is not known. */
function referringCounts(
  references: readonly IncomingReference[] | 'checking' | 'unknown',
): ReadonlyMap<string, number> | null {
  if (typeof references === 'string') return null;
  const counts = new Map<string, number>();
  for (const each of references) counts.set(each.from, (counts.get(each.from) ?? 0) + 1);
  return counts;
}

const GROUPS_KEY = 'aw.part.groups';
type GroupKey = 'layout' | 'fields' | 'readers' | 'links';

/** Which groups are open, for the panel and not per part, in this browser (the plan, R8). */
function useOpenGroups() {
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set((kept(GROUPS_KEY) ?? 'layout').split(' ')),
  );
  const toggle = (key: GroupKey) =>
    setOpen((was) => {
      const now = new Set(was);
      if (!now.delete(key)) now.add(key);
      keep(GROUPS_KEY, [...now].join(' '));
      return now;
    });
  return { open, toggle };
}

/** A group that folds: its name, and what it holds in a line when shut. Its body stays when shut. */
function PartGroup({
  name,
  icon,
  summary,
  open,
  onToggle,
  children,
}: {
  name: string;
  icon: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const body = useId();
  return (
    <section className={part['group']}>
      <h3 className={part['groupHeading']}>
        <button
          type="button"
          className={part['groupHead']}
          aria-expanded={open}
          aria-controls={body}
          onClick={onToggle}
        >
          <Icon name={icon} size={16} />
          <span className={part['groupName']}>{name}</span>
          {!open && (
            <span className={part['summary']} title={summary}>
              {summary}
            </span>
          )}
          <Icon name={open ? 'Chevron up' : 'Chevron down'} size={14} />
        </button>
      </h3>
      <div id={body} className={part['groupBody']} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** Everything the panel says of the part chosen, whoever is reading. */
export interface PartFacts {
  readonly node: OutlineViewNode;
  readonly names: Names;
  /** What holds it, and the matter of the top of its branch. */
  readonly parent: OutlineViewNode | null;
  readonly matter: OutlineViewNode['matter'];
  /** Its number now, if it has one. */
  readonly number: string | undefined;
  /** The number it would take were it and everything above it numbered. */
  readonly wouldBe: string | undefined;
  /** A placed component's state, where the reader may read it (WF-G). */
  readonly state: { readonly key: string; readonly name: string } | undefined;
  /** Its shareable address (STR-044). */
  readonly address: string | undefined;
  readonly references: readonly IncomingReference[] | 'checking' | 'unknown' | undefined;
  readonly referencedBy: ReactNode;
  /** The components it places that the reader may read, each a row (STR-075; R14-B). */
  readonly placed: readonly ComponentChoice[];
  readonly usedIn: ((component: ComponentChoice) => ReactNode) | undefined;
  readonly fieldCount: number;
  /** The version a reference resolves to, by its number, once the page has read it. */
  readonly version?: string | undefined;
  /** Who holds it now, in words (CNT-074), where anyone does. */
  readonly heldSaid?: string | undefined;
}

const MODE_WORDS = {
  latest: () => say('document.latest-version'),
  approved: () => say('document.approved-version'),
  pinned: () => say('document.pinned-version'),
} as const;

/** The part's words of where it stands, in the kicker: "Section · Body · Top level". */
function kickerOf({ node, parent, matter, names }: PartFacts): string {
  const where =
    parent === null
      ? say('document.top-level')
      : say('document.in-parent', { name: nodeName(parent, names) });
  return node.type === 'section'
    ? [say('document.section'), MATTERS.find((each) => each.value === matter)?.short, where]
        .filter((each) => each !== undefined)
        .join(' · ')
    : `${say('document.component')} · ${where}`;
}

/** What the part is, where it sits, its state and key facts: always shown, never folding. */
function PartIdentity({
  facts,
  title,
  uncopied,
}: {
  facts: PartFacts;
  /** A section's title field, where the reader may change it. */
  title: ReactNode;
  /** The address the clipboard would not take, to be copied by hand (the plan, R7). */
  uncopied: string | null;
}) {
  const { node, names, state, number, fieldCount, version, heldSaid } = facts;
  const unreadable = node.type === 'reference' && node.component === null;
  const count = node.type === 'section' ? componentsBeneath(node) : 0;
  const name = nodeName(node, names);
  return (
    <div className={part['identity']}>
      <span className={part['tile']} data-unreadable={unreadable ? '' : undefined}>
        <Icon
          name={
            unreadable
              ? 'state:notYoursToRead'
              : node.type === 'section'
                ? 'Part section'
                : 'Part component'
          }
          size={18}
        />
      </span>
      <div className={part['who']}>
        <p className={part['kicker']} title={kickerOf(facts)}>
          {kickerOf(facts)}
        </p>
        {node.type === 'section' &&
          (title ?? (
            <p className={part['name']} title={name}>
              {name}
            </p>
          ))}
        {/* A component has no title of its own, so its name is a link to it (ADR-0054, decision 8). */}
        {node.type === 'reference' &&
          (unreadable ? (
            <p className={part['name']} data-unreadable="">
              {name}
            </p>
          ) : (
            <a className={part['name']} href={`#/components/${node.component}`} title={name}>
              <span className={part['rowName']}>{name}</span>
              <Icon name="Go to text" size={13} />
            </a>
          ))}
        <div className={part['chips']}>
          {unreadable && <Lozenge kind="notYoursToRead" size="small" />}
          {state !== undefined && <StateLozenge size="small" state={state} />}
          {number !== undefined && (
            <Chip className={part['chip']}>
              <Icon name="Numbered" size={11} />
              {say('document.number-chip', { number })}
            </Chip>
          )}
          {count > 0 && (
            <Chip className={part['chip']}>
              <Icon name="Part component" size={11} />
              {say('document.count-components', { count })}
            </Chip>
          )}
          {node.type === 'section' && fieldCount > 0 && (
            <Chip className={part['chip']}>
              <Icon name="Fields" size={11} />
              {say('document.count-fields', { count: fieldCount })}
            </Chip>
          )}
          {node.type === 'reference' && !unreadable && (
            <Chip className={part['chip']}>{version ?? MODE_WORDS[node.mode.kind]()}</Chip>
          )}
        </div>
      </div>
      {unreadable && <p className={part['note']}>{say('document.may-not-read-this-component')}</p>}
      {heldSaid !== undefined && <p className={part['note']}>{heldSaid}</p>}
      {uncopied !== null && (
        <input
          readOnly
          className={part['address']}
          aria-label={say('document.link-to', { name })}
          value={uncopied}
          onFocus={(event) => event.target.select()}
        />
      )}
    </div>
  );
}

/** The heading, and the part's three acts as icons: go to it, copy its link, and Remove in red. */
function PartHead({
  facts,
  onGoTo,
  onCopied,
  onRemove,
}: {
  facts?: PartFacts | undefined;
  onGoTo?: () => void;
  onCopied?: (failed: boolean) => void;
  onRemove?: (() => void) | undefined;
}) {
  const name = facts === undefined ? '' : nodeName(facts.node, facts.names);
  return (
    <div className={part['head']}>
      <h2 className={part['heading']}>{say('document.part')}</h2>
      {facts !== undefined && (
        <div className={part['acts']}>
          <IconButton label={say('document.go-to-it-in-the-text')} onClick={onGoTo}>
            <Icon name="Go to the table" size={16} />
          </IconButton>
          {facts.address !== undefined && (
            <IconButton
              label={say('document.copy-a-link-to', { name })}
              onClick={() => {
                const copying = navigator.clipboard?.writeText(facts.address ?? '');
                if (!copying) return onCopied?.(true);
                void copying.then(
                  () => onCopied?.(false),
                  () => onCopied?.(true),
                );
              }}
            >
              <Icon name="Link" size={16} />
            </IconButton>
          )}
          {onRemove !== undefined && (
            <>
              <span className={part['rule']} aria-hidden="true" />
              <span className={part['removeIcon']}>
                <IconButton
                  label={
                    facts.node.type === 'section'
                      ? say('document.remove-section-named', { name })
                      : say('document.remove-component-named', { name })
                  }
                  onClick={onRemove}
                >
                  <Icon name="Delete" size={16} />
                </IconButton>
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** **Where it is used** for each component a part places (STR-075; R14-B). */
function WhereUsed({
  facts,
  open,
}: {
  facts: PartFacts;
  /** Read only once it can be seen: each row asks the service. */
  open: boolean;
}) {
  const label = useId();
  const { placed, usedIn, node } = facts;
  if (placed.length === 0 || usedIn === undefined) return null;
  return (
    <div className={part['links']}>
      <div className={part['linksHead']}>
        <span id={label}>
          {node.type === 'section'
            ? say('document.where-its-components-are-used')
            : say('document.where-it-is-used')}
        </span>
        <span>{placed.length}</span>
      </div>
      {open && (
        <ul aria-labelledby={label} className={part['rows']}>
          {placed.map((each) => (
            <li key={each.id}>{usedIn(each)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The Links group's line when shut: "1 referring · 2 components". */
function linksSummary(facts: PartFacts): string {
  const counts = facts.references === undefined ? null : referringCounts(facts.references);
  return [
    counts === null
      ? null
      : counts.size === 0
        ? say('document.nothing-refers')
        : say('document.count-referring', { count: counts.size }),
    facts.placed.length > 0
      ? say('document.count-components', { count: facts.placed.length })
      : null,
  ]
    .filter((each) => each !== null)
    .join(' · ');
}

/** The Layout group's line when shut: "A new page · numbered 6.1", with its matter at the top. */
function layoutSummary(facts: PartFacts): string {
  const { node, number, parent } = facts;
  return [
    PAGE_BREAKS.find((each) => each.value === node.pageBreak)?.label,
    number === undefined ? say('document.not-numbered') : say('document.numbered-as', { number }),
    parent === null ? MATTERS.find((each) => each.value === node.matter)?.label : undefined,
  ]
    .filter((each) => each !== undefined)
    .join(' · ');
}

/** What a reader who may not change the document is shown: where it is, and what refers to it. */
export function PartReadOnly({
  facts,
  onGoTo,
  onNotice,
}: {
  facts: PartFacts | undefined;
  onGoTo: () => void;
  onNotice: (message: string | null) => void;
}) {
  const { open, toggle } = useOpenGroups();
  const [uncopied, setUncopied] = useState<string | null>(null);
  if (facts === undefined) return <PartHead />;
  return (
    <div className={part['panel']}>
      <div className={part['fixed']}>
        <PartHead
          facts={facts}
          onGoTo={onGoTo}
          onCopied={copiedWith(facts, onNotice, setUncopied)}
        />
        <PartIdentity facts={facts} title={null} uncopied={uncopied} />
      </div>
      {(facts.references !== undefined || facts.placed.length > 0) && (
        <PartGroup
          name={say('document.group-links')}
          icon="Link"
          summary={linksSummary(facts)}
          open={open.has('links')}
          onToggle={() => toggle('links')}
        >
          {facts.referencedBy}
          <WhereUsed facts={facts} open={open.has('links')} />
        </PartGroup>
      )}
    </div>
  );
}

const copiedWith =
  (
    facts: PartFacts,
    onNotice: (message: string | null) => void,
    setUncopied: (address: string | null) => void,
  ) =>
  (failed: boolean) => {
    onNotice(
      failed
        ? say('document.the-link-could-not-be')
        : say('document.copied-the-link-to', { name: nodeName(facts.node, facts.names) }),
    );
    setUncopied(failed ? (facts.address ?? null) : null);
  };

/** The Part panel for an author: the head and identity fixed, four groups folding beneath. */
export function PartPanel({
  facts,
  busy,
  topLevel,
  frontOffered,
  frontAfter,
  unnumberedAbove,
  onOperation,
  onRetitle,
  openField,
  onNotice,
  onRemove,
  onGoTo,
  language,
  direction,
  onEquation,
  onWithdrawEquation,
  sectionFields,
  schemas,
  people,
  conditionsSaid,
  onConditions,
}: {
  facts: PartFacts;
  busy: boolean;
  /** Whether the node is at the top level, the only place `matter` may be set (STR-016). */
  topLevel: boolean;
  /** Whether **Front matter** is one of the node's choices: what `mayBeFront` says (STR-064). */
  frontOffered: boolean;
  /**
   * The front node after this one, beneath which its matter cannot change at all: what `frontAfter`
   * says (STR-064). Only a front node ever has one.
   */
  frontAfter: OutlineViewNode | undefined;
  /** The nearest ancestor not numbered, beneath which this node takes no number whatever it says. */
  unnumberedAbove: OutlineViewNode | undefined;
  onOperation: (operation: OutlineOperation) => Promise<Answered>;
  onRetitle: (operation: RetitleOperation) => Promise<RetitleAnswer>;
  openField: MutableRefObject<string | null>;
  onNotice: (message: string | null) => void;
  onRemove: () => void;
  onGoTo: () => void;
  /** The document's language and direction, which a section's title is written in. */
  language: string;
  direction: 'ltr' | 'rtl';
  /** Opens the Equation dialog for the title field (equations 3, ruling R3). */
  onEquation: (request: EquationRequest) => void;
  /** Closes that dialog, placing nothing, because the title changed under it. */
  onWithdrawEquation: () => void;
  sectionFields: readonly FieldView[];
  schemas: readonly { readonly id: string; readonly name: string }[];
  people: readonly { readonly id: string; readonly name: string }[];
  /** What it is kept for in words, or null for every reader (REU-021, REU-026; the R12 plan). */
  conditionsSaid: string | null;
  onConditions?: ((node: string) => void) | undefined;
}) {
  const { node, names, number, wouldBe } = facts;
  const { open, toggle } = useOpenGroups();
  const [uncopied, setUncopied] = useState<string | null>(null);
  const hintId = useId();
  const matterHintId = useId();
  const numberedId = useId();
  const lineId = useId();
  const name = nodeName(node, names);
  const locked = unnumberedAbove !== undefined;
  // Ticked, and still without a number: said beside the box, so the tick does not look ignored.
  const hint = locked
    ? say('document.not-numbered-while-is-not', { value1: nodeName(unnumberedAbove, names) })
    : null;
  const line = locked
    ? wouldBe === undefined
      ? null
      : say('document.would-be', { number: wouldBe })
    : node.numbered
      ? number === undefined
        ? null
        : say('document.shown-as-number', { number })
      : say('document.takes-no-number');
  // Front matter with front matter after it: every other matter would strand that one after this
  // one, which the outline's parse refuses, so there is nothing this control can be given. Said
  // beside it and the control disabled, rather than a choice of one, which reads as broken.
  const matterHint =
    frontAfter === undefined
      ? null
      : say('document.front-matter-comes-first-so', { value1: nodeName(frontAfter, names) });
  // Offered only where the number would stay what the title says, so taking it off changes nothing
  // the reader sees; and never where it would leave no title (the plan, R2).
  const typed =
    node.type === 'section' && !node.numbered && !locked ? typedNumber(node.title) : null;
  const offered =
    node.type === 'section' &&
    typed !== null &&
    wouldBe !== undefined &&
    sameNumber(typed, wouldBe);
  const unreadable = node.type === 'reference' && node.component === null;
  return (
    <div className={part['panel']}>
      <div className={part['fixed']}>
        <PartHead
          facts={facts}
          onGoTo={onGoTo}
          onCopied={copiedWith(facts, onNotice, setUncopied)}
          onRemove={() => !busy && onRemove()}
        />
        <PartIdentity
          facts={facts}
          uncopied={uncopied}
          title={
            node.type === 'section' && (
              <TitleField
                node={node}
                onRetitle={onRetitle}
                openField={openField}
                onNotice={onNotice}
                language={language}
                direction={direction}
                onEquation={onEquation}
                onWithdrawEquation={onWithdrawEquation}
              />
            )
          }
        />
      </div>
      <PartGroup
        name={say('document.group-layout')}
        icon="Layout"
        summary={layoutSummary(facts)}
        open={open.has('layout')}
        onToggle={() => toggle('layout')}
      >
        <div className={part['control']}>
          <span className={part['label']} aria-hidden="true">
            {say('document.starts-on')}
          </span>
          {/* Left enabled while an act is in flight, so it keeps the focus; a choice made then is not
              sent, and the control, being controlled, goes on showing what the node holds. */}
          <Segmented
            label={say('document.starts-on')}
            value={node.pageBreak}
            className={part['startsOn']}
            options={PAGE_BREAKS.map((each) => ({
              value: each.value,
              name: each.label,
              label: each.short,
              icon: each.icon,
            }))}
            onChange={(pageBreak) => {
              if (busy || !isPageBreak(pageBreak) || pageBreak === node.pageBreak) return;
              void onOperation({ operation: 'set', node: node.id, pageBreak });
            }}
          />
        </div>
        {/* Controlled, and left enabled while an act is in flight, as the control above is. Locked
            under a part not numbered, whose say it is, with why beneath. */}
        <div className={part['numbered']} data-locked={locked ? '' : undefined}>
          <span className={part['numberedLabel']}>
            <label htmlFor={numberedId}>{say('document.numbered')}</label>
            {line !== null && (
              <span id={lineId} className={part['line']}>
                {line}
              </span>
            )}
          </span>
          <input
            id={numberedId}
            type="checkbox"
            role="switch"
            className={styles['switch']}
            checked={node.numbered}
            aria-disabled={locked}
            aria-describedby={
              [line === null ? '' : lineId, hint === null ? '' : hintId].join(' ').trim() ||
              undefined
            }
            onChange={(event) => {
              if (busy || locked) return;
              void onOperation({ operation: 'set', node: node.id, numbered: event.target.checked });
            }}
          />
        </div>
        {hint !== null && (
          <p id={hintId} className={part['locked']}>
            <Icon name="state:notYoursToRead" size={12} />
            {hint}
          </p>
        )}
        {offered && (
          <div className={part['offer']}>
            <Icon name="Numbered" size={14} />
            <p>{say('document.typed-number-offer', { number: typed })}</p>
            <button
              type="button"
              onClick={() => {
                if (busy) return;
                void onOperation({
                  operation: 'set',
                  node: node.id,
                  numbered: true,
                  title: [...withoutTypedNumber(node.title)],
                });
              }}
            >
              {say('document.number-it')}
            </button>
          </div>
        )}
        {/* Offered at the top level alone: below it a node's matter is its top-level ancestor's, and
            the outline's parse refuses one set anywhere else. **Front matter** is left out where the
            parse would refuse it, so only what can be chosen is offered - a node already in front
            matter keeps it whatever `mayBeFront` says. Left enabled while an act is in flight. */}
        {topLevel && (
          <div className={part['control']}>
            <span className={part['label']} aria-hidden="true">
              {say('document.matter')}
            </span>
            <Segmented
              label={say('document.matter')}
              value={node.matter}
              disabled={matterHint !== null}
              describedBy={matterHint === null ? undefined : matterHintId}
              options={MATTERS.filter(
                (each) => each.value !== 'front' || frontOffered || node.matter === 'front',
              ).map((each) => ({ value: each.value, name: each.label, label: each.short }))}
              onChange={(matter) => {
                if (busy || !isMatter(matter) || matter === node.matter) return;
                void onOperation({ operation: 'set', node: node.id, matter });
              }}
            />
            {matterHint !== null && (
              <span id={matterHintId} className={styles['hint']}>
                {matterHint}
              </span>
            )}
          </div>
        )}
      </PartGroup>
      {/* A section's own fields, from its document's template, saved with the outline's set a pause
          after the last change (definitions.md; STR-060). A component's are its own, in its editor. */}
      {node.type === 'section' && sectionFields.length > 0 && (
        <PartGroup
          name={say('document.group-fields')}
          icon="Fields"
          summary={say('document.from-the-template', { count: sectionFields.length })}
          open={open.has('fields')}
          onToggle={() => toggle('fields')}
        >
          <p className={part['said']}>{say('document.from-the-documents-template')}</p>
          <FieldKindIcons value>
            <HeldFields
              label={say('document.fields-of', { value1: name })}
              fields={sectionFields}
              schemas={schemas}
              people={people}
              stored={node.values}
              readOnly={false}
              onSave={async (values) => {
                const answered = await onOperation({ operation: 'set', node: node.id, values });
                return answered === 'unsent'
                  ? 'unsent'
                  : answered === 'refused' || answered === 'signedOut'
                    ? 'refused'
                    : 'saved';
              }}
            />
          </FieldKindIcons>
        </PartGroup>
      )}
      <PartGroup
        name={say('document.group-readers')}
        icon="Readers"
        summary={conditionsSaid ?? say('document.every-reader')}
        open={open.has('readers')}
        onToggle={() => toggle('readers')}
      >
        <div className={part['readers']}>
          <span>{conditionsSaid ?? say('document.kept-for-every-reader')}</span>
          {onConditions && (
            <button
              type="button"
              aria-label={say('document.set-condition-on', { value1: name })}
              onClick={() => onConditions(node.id)}
            >
              {conditionsSaid === null ? say('document.set-condition') : say('document.change-it')}
            </button>
          )}
        </div>
      </PartGroup>
      {(facts.references !== undefined || facts.placed.length > 0 || !unreadable) && (
        <PartGroup
          name={say('document.group-links')}
          icon="Link"
          summary={linksSummary(facts)}
          open={open.has('links')}
          onToggle={() => toggle('links')}
        >
          {facts.referencedBy}
          <WhereUsed facts={facts} open={open.has('links')} />
        </PartGroup>
      )}
    </div>
  );
}

/**
 * What a section title field shows and what the outline held when it last heard: the same
 * reconciliation `ComponentHeader` uses, by value and never by counting renders, so StrictMode's second
 * pass cannot eat a keystroke and an unrelated re-render cannot revert a field being typed.
 *
 * **Titles, compared by their canonical form** (equations 3, ruling R2): a title may hold an equation,
 * and its words are then only the equation's alternative, which two different equations can share -
 * so "the same title" is `canonicaliseTitle`'s answer, the form the outline's digest takes, and never
 * a comparison of words. `typed` is what the field's editor holds, mirrored as it changes; setting it
 * to anything else puts that into the editor.
 */
interface Field {
  readonly typed: Title;
  readonly inModel: Title;
  /**
   * The canonical form of every title this field has sent and not yet heard back about, oldest first.
   * A second commit can be made while the first is still in flight, and either coming back is this
   * field's own.
   */
  readonly sent: readonly string[];
}

/** `sent` with the first occurrence of `key` taken out: the one commit that will not come back. */
function withoutFirst(sent: readonly string[], key: string): readonly string[] {
  const at = sent.indexOf(key);
  return at < 0 ? sent : [...sent.slice(0, at), ...sent.slice(at + 1)];
}

/**
 * Why a title is not changed here, in the words of what it holds that the field cannot keep: a
 * cross-reference, a footnote, formatting, or - an image, a variable - anything else.
 */
function heldBack(title: Title): string {
  if (title.some((run) => run.type === 'crossReference')) {
    return say('document.this-title-holds-a-cross');
  }
  if (title.some((run) => run.type === 'footnote')) {
    return say('document.this-title-holds-a-footnote');
  }
  if (title.some((run) => run.type === 'text' && run.marks.length > 0)) {
    return say('document.this-title-has-formatting-this');
  }
  return say('document.this-title-holds-something-this');
}

/** The words a title's text runs hold, joined: what the store's `hasText` asks of a title. */
const wordsOf = (title: Title) =>
  title.map((run) => (run.type === 'text' ? run.value : '')).join('');

/**
 * **A section's title field** (equations 3, rulings R1 to R3): the title editor from
 * `packages/editor`, one line of words and inline equations, for a title holding only those; a title
 * holding a mark or a cross-reference keeps a read-only field and a sentence saying what it holds,
 * because an edit here would quietly drop it.
 *
 * The retitle state machine is the one a plain text field had, by canonical title rather than by
 * text: what was typed, what the outline held when the field last heard, and what it has sent - so a
 * retitle in flight, a refusal, an undo and another author's title behave as they always did, an
 * equation included. **Equation** beside it, and `Mod-Shift-E` or `Enter` on an equation in it, open
 * the Equation dialog for the title; placing one commits the title as it then stands.
 */
function TitleField({
  node,
  onRetitle,
  openField,
  onNotice,
  language,
  direction,
  onEquation,
  onWithdrawEquation,
}: {
  node: SectionViewNode;
  onRetitle: (operation: RetitleOperation) => Promise<RetitleAnswer>;
  openField: MutableRefObject<string | null>;
  onNotice: (message: string | null) => void;
  language: string;
  direction: 'ltr' | 'rtl';
  onEquation: (request: EquationRequest) => void;
  onWithdrawEquation: () => void;
}) {
  // Says which section's field is open, for as long as it is: written in an effect, never in render.
  useEffect(() => {
    openField.current = node.id;
    return () => {
      if (openField.current === node.id) openField.current = null;
    };
  }, [openField, node.id]);

  const editable = titleToEditor(node.title) !== null;
  const inModel = canonicaliseTitle(node.title);
  const [field, setField] = useState<Field>({ typed: node.title, inModel: node.title, sent: [] });

  // State derived from a prop, adjusted during render the way React documents it: a second render
  // pass reads what the first set, and the comparison is by value, so it settles at once. Nothing
  // happens unless the outline's title differs from what the field last heard, so a re-render for
  // any other reason - another act answered while the author is typing here - leaves the field alone.
  // When it does differ, any of the field's own retitles coming back keeps what has been typed since
  // (and the ones sent after it are still to come); anything else - an undo, somebody else's title -
  // gives way to the outline.
  if (inModel !== canonicaliseTitle(field.inModel)) {
    const at = field.sent.indexOf(inModel);
    setField(
      at >= 0
        ? { typed: field.typed, inModel: node.title, sent: field.sent.slice(at + 1) }
        : { typed: node.title, inModel: node.title, sent: [] },
    );
  }

  const place = useRef<HTMLDivElement | null>(null);
  const editor = useRef<TitleEditor | null>(null);
  // The field is asking for its dialog: the focus leaving it for the dialog is not the author leaving
  // the title, so it commits nothing until the dialog places an equation or is closed.
  const asking = useRef(false);
  // Read by the editor's keys, which are bound once as it mounts: always this render's.
  const typed = useRef(field.typed);
  typed.current = field.typed;
  const commitNow = useRef(() => {});
  const promptNow = useRef(() => {});
  const withdrawNow = useRef(onWithdrawEquation);
  withdrawNow.current = onWithdrawEquation;

  // The editor, mounted into its place as the field appears and destroyed as it goes: a layout effect,
  // so the field is there in the same commit as the details around it, as a text input was.
  useLayoutEffect(() => {
    const host = place.current;
    if (!editable || host === null) return undefined;
    const mounted = mountTitleEditor(host, {
      title: typed.current,
      label: say('document.title'),
      language,
      direction,
      onChange: (title) => setField((previous) => ({ ...previous, typed: title })),
      onCommit: () => commitNow.current(),
      onPromptEquation: () => promptNow.current(),
    });
    editor.current = mounted;
    return () => {
      editor.current = null;
      mounted.destroy();
      // The field going, or turning read-only, under its dialog: nothing is left to place into.
      if (asking.current) withdrawNow.current();
    };
  }, [editable, language, direction]);

  // The field given way to the outline, or put back after a refusal: what it now says it holds is put
  // into the editor. Typing reaches here too, and changes nothing, because the editor already holds it.
  // A title put in under the field's own dialog takes the dialog away with it: what it was opened on is
  // gone, and placing its answer would change an equation, or a title, the author never saw.
  useLayoutEffect(() => {
    const mounted = editor.current;
    if (mounted === null) return;
    if (canonicaliseTitle(mounted.read()) !== canonicaliseTitle(field.typed)) {
      mounted.replace(field.typed);
      if (asking.current) withdrawNow.current();
    }
  }, [field.typed]);

  if (!editable) {
    return (
      <>
        <div className={styles['partRow']}>
          <label className={styles['rowLabel']}>
            {say('document.title')}
            <input className={styles['hiddenInput']} value={titleText(node.title)} disabled />
          </label>
          <span className={styles['stack']}>
            <span className={styles['field']} data-field="">
              <input value={titleText(node.title)} disabled aria-hidden="true" tabIndex={-1} />
            </span>
            <span className={styles['hint']}>{heldBack(node.title)}</span>
          </span>
        </div>
      </>
    );
  }

  // Committed whether or not another act is in flight: `onRetitle` holds it until that act is
  // answered, so nothing typed is dropped because the author pressed Enter, or left, too soon. Read
  // from the editor rather than from `typed`, which an equation placed a moment ago has not reached.
  const commit = () => {
    const title = trimTitle(editor.current?.read() ?? field.typed);
    // The store's own rule (`hasText`), asked here so the field refuses exactly what the store would.
    if (!hasText(wordsOf(title))) {
      if (title.some((run) => run.type === 'equation')) {
        // An equation is not a title on its own - a title also names its section wherever a name
        // must be words - but it is the author's, so it is kept for them to write words beside.
        onNotice(say('document.a-section-s-title-needs'));
        return;
      }
      // Nothing was sent, so the outline never changed and the comparison above never resyncs this
      // field by itself: it is put back here, or it would sit empty beside a tree showing the title.
      onNotice(say('document.a-section-needs-a-title'));
      setField({ typed: node.title, inModel: node.title, sent: [] });
      return;
    }
    const key = canonicaliseTitle(title);
    // Nothing new: the outline holds it, or it is the title this field sent last and is still waiting
    // on - the blur that follows an Enter - so it is not committed a second time.
    if (key === inModel || key === field.sent[field.sent.length - 1]) return;
    setField((previous) => ({ ...previous, sent: [...previous.sent, key] }));
    void onRetitle({ operation: 'retitle', node: node.id, title }).then((answer) => {
      if (answer === 'refused') {
        // The page now shows an outline other than the one this title was typed against, and has
        // said so. The field gives way to it, rather than holding the refused title for the next
        // blur to send again as an act nobody chose a second time.
        setField((previous) => ({
          typed: previous.inModel,
          inModel: previous.inModel,
          sent: [],
        }));
      } else if (answer === 'unsent' || answer === 'signedOut' || answer === 'superseded') {
        // Nothing changed and nothing was recorded - or a later commit took its place - so it will
        // not come back: the title stays, and after a failure the author's next Enter or blur is the
        // retry the page asks for.
        setField((previous) => ({ ...previous, sent: withoutFirst(previous.sent, key) }));
      }
    });
  };
  commitNow.current = commit;

  // The dialog for the title: on the equation selected whole in it, or for a new one at the caret.
  // Placing it commits the title as it then stands, which is the one act the author asked for.
  const openEquation = () => {
    const mounted = editor.current;
    if (mounted === null) return;
    asking.current = true;
    const current = mounted.equationAt();
    onEquation({
      current,
      place: (choice) => {
        const into = editor.current;
        if (into === null) {
          return say('document.this-title-can-no-longer');
        }
        const placed =
          current === null ? into.insertEquation(choice) : into.changeEquation(current.pos, choice);
        if (!placed) {
          return current === null
            ? say('document.an-equation-cannot-be-placed')
            : say('document.that-equation-is-not-there');
        }
        asking.current = false;
        // This render's commit, not the one the dialog was opened from: an answer to an earlier
        // retitle may have arrived while the dialog stood, and what was sent is read from the latest.
        commitNow.current();
        return null;
      },
      back: () => {
        asking.current = false;
        const into = editor.current;
        if (into === null) return false;
        into.focus();
        return true;
      },
    });
  };
  promptNow.current = openEquation;

  // The field and its button are one place to the author: the focus moving between them is not
  // leaving the title, and leaving both is, as leaving a text input was. The focus leaving for the
  // title's own dialog is not either: placing an equation commits, and cancelling comes back here.
  return (
    <div
      onFocus={() => {
        asking.current = false;
      }}
      onBlur={(event) => {
        if (asking.current || event.currentTarget.contains(event.relatedTarget)) return;
        commit();
      }}
    >
      <span className={styles['field']} data-field="">
        <div ref={place} className={styles['titleField']} />
        <button
          type="button"
          className={styles['inField']}
          aria-haspopup="dialog"
          aria-label={say('document.equation')}
          title={say('document.equation-ctrl-or-cmd-shift')}
          // The caret stays in the title, where the equation goes, as a toolbar's button leaves it.
          onMouseDown={(event) => event.preventDefault()}
          onClick={openEquation}
        >
          <Icon name="Equation" size={14} />
        </button>
      </span>
    </div>
  );
}
