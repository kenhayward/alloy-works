import { words as say } from '../words/words.js';

/** What a panel asks of the page it may stand on: pure, so each page's set is pinned (ADR-0085). */
export interface PanelContext {
  readonly kind: 'document' | 'component';
  readonly mode: 'reading' | 'review' | 'authoring';
  /** A document's own fields, parameters or profile to set. */
  readonly holdsOwn: boolean;
  /** The selection stands where it has settings (ADR-0075). */
  readonly selectionHeld: boolean;
  /** A component open holds a table (ADR-0052). */
  readonly tableHolds: boolean;
}

const a = (kind: PanelContext['kind']) => (context: PanelContext) => context.kind === kind;
const aDocument = a('document');

/**
 * The panels beside the text, named in words and drawn as icons on the rail (ADR-0074; the LG plan,
 * LG6c), each declared once with where it applies (ADR-0085). In the order of the rail.
 */
export const PANELS = [
  {
    key: 'selection',
    icon: 'Format',
    applies: (context: PanelContext) => context.selectionHeld,
    get label() {
      return say('document.selection');
    },
  },
  {
    key: 'table',
    icon: 'Table',
    applies: (context: PanelContext) => context.tableHolds,
    get label() {
      return say('document.table');
    },
  },
  {
    key: 'part',
    icon: 'Part',
    applies: () => true,
    get label() {
      return say('document.part');
    },
  },
  {
    key: 'document',
    icon: 'Document',
    applies: (context: PanelContext) => aDocument(context) && context.holdsOwn,
    get label() {
      return say('document.document');
    },
  },
  {
    key: 'lists',
    icon: 'Lists',
    applies: aDocument,
    get label() {
      return say('document.lists');
    },
  },
  // Drafting against the document (the G2 plan, G2-K); before Publishing, which stays last, where End
  // reaches it.
  {
    key: 'assistant',
    icon: 'Assistant',
    applies: (context: PanelContext) => aDocument(context) && context.mode === 'authoring',
    get label() {
      return say('document.assistant');
    },
  },
  // Its versions and their restore (the RS plan, RS-H); before Publishing, which End reaches.
  {
    key: 'versions',
    icon: 'Versions',
    applies: () => true,
    get label() {
      return say('document.versions');
    },
  },
  {
    key: 'publishing',
    icon: 'Publishing',
    applies: aDocument,
    get label() {
      return say('document.publishing');
    },
  },
  // In Review and while authoring (the TH plan, Task 3; the SG plan, Task 3).
  {
    key: 'threads',
    icon: 'Threads',
    applies: (context: PanelContext) => aDocument(context) && context.mode !== 'reading',
    get label() {
      return say('document.threads');
    },
  },
  {
    key: 'suggestions',
    icon: 'Suggestions',
    applies: (context: PanelContext) => aDocument(context) && context.mode === 'review',
    get label() {
      return say('document.suggestions');
    },
  },
  // In Review (the RR plan, Task 4).
  {
    key: 'rounds',
    icon: 'Rounds',
    applies: (context: PanelContext) => aDocument(context) && context.mode === 'review',
    get label() {
      return say('document.rounds');
    },
  },
  // In Review: cited sources retracted or corrected (the XR plan, XR-G).
  {
    key: 'sources',
    icon: 'Source',
    applies: (context: PanelContext) => aDocument(context) && context.mode === 'review',
    get label() {
      return say('document.sources');
    },
  },
] as const;

export type PanelKey = (typeof PANELS)[number]['key'];

export const panelsFor = (context: PanelContext) => PANELS.filter((each) => each.applies(context));

/** Its name on this kind of page: a component's part panel holds its attributes. */
export const panelLabel = (panel: (typeof PANELS)[number], kind: PanelContext['kind']): string =>
  panel.key === 'part' && kind === 'component' ? say('editor.attributes') : panel.label;

/** A panel's tab and body, by the kind of page: one of each kind may be kept beside the other. */
export const panelIds = (kind: PanelContext['kind']) => (key: string) => ({
  tab: `${kind}-tab-${key}`,
  panel: `${kind}-panel-${key}`,
});

/** What a selection may take the panels from: not the Assistant, nor Threads (ADR-0079). */
export const selectionMayTake = (panel: string): boolean =>
  !['assistant', 'threads', 'selection'].includes(panel);
