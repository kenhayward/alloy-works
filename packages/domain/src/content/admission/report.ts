/**
 * The admission report: a collector threaded through all six stages, returned with the admitted
 * content rather than logged, because the author is shown it at the time.
 *
 * Every message is a fixed string chosen by what happened, and nothing from the content is ever
 * interpolated into one. What arrived - a link's target, an event handler's name - travels in
 * `detail`, as data the caller renders as text. Content is data, never instructions, and a report
 * built by pasting hostile text into a sentence is a report that can be made to say anything.
 */
export const admissionStages = [
  'read',
  'sanitise',
  'migrate',
  'normalise',
  'reidentify',
  'validate',
] as const;

export type AdmissionStage = (typeof admissionStages)[number];

export const reportMessages = {
  discarded: {
    script: 'A script was removed. Scripts are never stored.',
    embeddedObject: 'An embedded object was removed. Embedded objects are never stored.',
    eventHandler: 'An event handler was removed. Event handlers are never stored.',
    executableStyle: 'Formatting that could run code or fetch a resource was removed.',
    hyperlink:
      'A link was removed because its target is not a web or email address. Its text was kept.',
    mathElement: 'Part of an equation that is not standard MathML was removed.',
    mathAttribute: 'A setting on an equation that is not standard MathML was removed.',
    mathText: 'Text standing outside any symbol in an equation was removed.',
    equation: 'An equation that could not be read was removed.',
    typeface: 'A typeface was removed. The theme decides how text looks.',
    size: 'A text size was removed. The theme decides how text looks.',
    colour: 'A colour was removed. The theme decides how text looks.',
    appearance: 'Formatting was removed. The theme decides how content looks.',
    emptyText: 'Empty runs of text were removed.',
    emptyParagraph:
      'Empty paragraphs used as spacing were removed. The theme decides the space between paragraphs.',
    language: 'The language of the content was not a recognised language tag, so it was not kept.',
    direction: 'The text direction of the content could not be kept.',
    comment: 'A comment was removed. Comments stay with the component they were made on.',
    suggestion:
      'A suggested change was removed and its text kept as it stood. Suggestions stay with the component they were made on.',
    condition: 'A condition was removed, because this space has no condition of that kind.',
    unrepresentable: 'Something this component cannot hold was left out.',
    // A reader's, each for something an author pastes often enough to be told about in words of
    // its own rather than as `unrepresentable`.
    image: 'An image was left out. Images cannot be pasted yet.',
    mathematics: 'An equation was left out. Equations cannot be pasted yet.',
    rule: 'A horizontal line was left out.',
    control: 'Invisible control characters were removed.',
  },
  rewritten: {
    hyperlink: 'A link target was rewritten in the form every browser reads the same way.',
    equation: 'Equations were rewritten in one standard form.',
    unicode: 'Text was put in one standard Unicode form, so identical text compares alike.',
    language: 'The text was marked with the language of the component it came from.',
    schemaVersion: 'The content was brought up to date from an earlier version of the format.',
    blockIdentifier:
      'Blocks, footnotes and cross-references were given new identifiers, so they cannot be mistaken for the ones they were copied from.',
    crossReferenceTarget:
      'Cross-references copied with what they refer to were pointed at the copy.',
    markIdentifier: 'Marks were given new identifiers.',
    // A reader's: kept, but not as what it was.
    heading: "A heading was kept as a paragraph. A document's headings are its section titles.",
    table: 'A table inside a table cell was kept as its text, one paragraph for each cell.',
    tableShape: "A table's rows were made the same length.",
    cellBlocks: 'A quotation or preformatted text in a table cell was kept as paragraphs.',
  },
  /**
   * Kept exactly as it arrived, and worth the author knowing: nothing was removed or changed, so it
   * is neither `discarded` nor `rewritten`, and it was added, so it is not `refused`.
   */
  kept: {
    crossReferenceUnresolved:
      'Cross-references to something this component does not hold were kept as they stood, and point at nothing until it does.',
  },
  refused: {
    oversized: 'Nothing was added, because the content is larger than one addition can hold.',
    unreadable: 'Nothing was added, because the content could not be read.',
    schemaVersion:
      'Nothing was added, because the content was written in a version of the format this build cannot read.',
    identifiers: 'Nothing was added, because new identifiers could not be allocated.',
    invalid: 'Nothing was added, because what arrived is not content this component can hold.',
    empty: 'Nothing was added, because nothing in it could be kept.',
  },
} as const;

export type ReportAction = keyof typeof reportMessages;
export type ReportSubject<A extends ReportAction = ReportAction> = A extends ReportAction
  ? keyof (typeof reportMessages)[A]
  : never;

export type ReportEntry = {
  readonly stage: AdmissionStage;
  readonly action: ReportAction;
  readonly subject: string;
  readonly message: string;
  /** What arrived, as data: a link's target, a handler's name. Rendered as text, never as markup. */
  readonly detail?: string;
  /** How many, where one entry stands for several of a kind. */
  readonly count?: number;
};

export type ReportCollector = {
  add<A extends ReportAction>(
    stage: AdmissionStage,
    action: A,
    subject: ReportSubject<A>,
    extra?: { detail?: string; count?: number },
  ): void;
  readonly entries: readonly ReportEntry[];
};

export function createReport(initial: readonly ReportEntry[] = []): ReportCollector {
  const entries: ReportEntry[] = [...initial];
  return {
    add(stage, action, subject, extra = {}) {
      const messages: Record<string, string> = reportMessages[action];
      const message = messages[subject as string];
      if (message === undefined) throw new Error(`No report message for ${action} ${subject}`);
      entries.push({
        stage,
        action,
        subject: subject as string,
        message,
        ...(extra.detail === undefined ? {} : { detail: extra.detail }),
        ...(extra.count === undefined ? {} : { count: extra.count }),
      });
    },
    get entries() {
      return [...entries];
    },
  };
}

/**
 * How a reader says it could not represent something. A reader appends rather than shrugging: the
 * spike's Word importer dropped three empty paragraphs without counting them, and every assertion in
 * its test was about what came through.
 */
export function readerEntry(detail: string): ReportEntry {
  return {
    stage: 'read',
    action: 'discarded',
    subject: 'unrepresentable',
    message: reportMessages.discarded.unrepresentable,
    detail,
  };
}
