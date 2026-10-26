import type { AnyBinding } from '@alloy-works/domain';
import { useId, type Ref } from 'react';

import { queryDefinitionLink } from '../data/links.js';
import { longDate } from '../data/shapes.js';
import { Chip } from '../parts/Chip.js';
import { IconButton } from '../parts/IconButton.js';
import type { BindingState } from '../structure/bindingContexts.js';
import { Icon } from './Icon.js';
import styles from './ValuePanel.module.css';
import { words } from '../words/words.js';

/** Each mode's word on its chip, and the rest of what it means, said after it and in its title. */
const MODES = {
  get checked() {
    return [words('editor.value.checked'), words('editor.value.checked-means')] as const;
  },
  get pinned() {
    return [words('editor.value.pinned'), words('editor.value.pinned-means')] as const;
  },
};

export interface ValuePanelProps {
  /** The binding selected whole, or a bound figure's or a bound table's, as the component stores it. */
  readonly binding: AnyBinding;
  /** What it shows where it stands: the value, why there is none, or what it asks for. */
  readonly shown: string;
  /**
   * Whether the document holds a result for it as the editor holds it now (`BindingShown.resolved`):
   * only then has it a provenance to open.
   */
  readonly resolved: boolean;
  /** What the bindings view says of it, in a document; absent on its own, or before the page heard. */
  readonly state?: BindingState | undefined;
  /**
   * Its definition's title on its own page, null where the reader may not read it, and undefined until
   * it is answered.
   */
  readonly title?: string | null | undefined;
  /**
   * Opens its provenance, offered where the document holds a result for it as it stands, given the
   * button: what opened it, whatever holds the focus as it is pressed.
   */
  readonly onProvenance?: ((opener: HTMLElement) => void) | undefined;
  /** Opens the Value dialog on it, to change it (B2); absent where it may not be changed. */
  readonly onChange?: (() => void) | undefined;
  /** Keeps what it holds under the binding as it now stands, offered where that may be (B2-G). */
  readonly onKeep?: (() => void) | undefined;
  /** Resolves it, in a document where nothing may be kept (B2-G). */
  readonly onResolve?: (() => void) | undefined;
  /**
   * Revises its value by hand, or a bound table's cell (the RV plan, RV-I, RV-J), or withdraws a
   * revision standing; absent where the reader may not.
   */
  readonly onRevise?: ((act: 'revise' | 'withdraw') => void) | undefined;
  /** The panel's own element: a region `F6` moves between while a binding is selected (CNT-077). */
  readonly ref?: Ref<HTMLElement>;
  /** In the Table tab: two lines, what it is and its acts, then what it shows (ADR-0052). */
  readonly stacked?: boolean;
}

/**
 * **The Value panel** (the B1 plan, B1-M; bindings.md, "Keyboard and accessibility"), one line (ADR-0051,
 * decision 2) - on its own while a binding is selected whole, or the first line of the Bound table band:
 * what it shows, its definition as a link,
 * its mode and when its value was fetched, and **Provenance**, which opens the whole of it beside the
 * text; **Change**, which opens the Value dialog on it; and in a document **Keep** where what it held
 * may be kept under the binding as it now stands, **Resolve** otherwise (the B2 plan, B2-G).
 */
export function ValuePanel({
  binding,
  shown,
  resolved,
  state,
  title,
  onProvenance,
  onChange,
  onKeep,
  onResolve,
  onRevise,
  ref,
  stacked = false,
}: ValuePanelProps) {
  const heading = useId();
  const unreadable = words('editor.a-query-definition-you-cannot');
  const named =
    state !== undefined
      ? (state.definition?.title ?? null)
      : title === undefined
        ? undefined
        : (title ?? null);
  const version = state?.definition?.version;
  const held = state?.held ?? null;
  const [mode, means] = MODES[binding.mode];
  // A value it takes, or a table's cells, held and not changed since: what a person may revise.
  const revisable =
    onRevise !== undefined &&
    held !== null &&
    !held.stale &&
    held.taken !== null &&
    ('value' in held.taken || 'table' in held.taken);
  const standing = (state?.revisions ?? []).some((each) => each.stands);
  const table = held?.taken !== null && held?.taken !== undefined && 'table' in held.taken;
  return (
    <section
      ref={ref}
      className={stacked ? `${styles['line']} ${styles['stacked']}` : styles['line']}
      aria-labelledby={heading}
      tabIndex={-1}
    >
      <h3 id={heading} className={styles['hidden']}>
        {words('editor.value')}
      </h3>
      <span className={styles['glyph']} aria-hidden="true">
        <Icon name="Value" />
      </span>
      {named !== undefined && (
        <span className={styles['named']}>
          {named === null ? unreadable : <a href={queryDefinitionLink(binding.query)}>{named}</a>}
          {version !== undefined && (
            <span className={styles['mono']}>{words('editor.version-3', { version })}</span>
          )}
        </span>
      )}
      <span className={styles['shown']}>{shown}</span>
      <Chip tone="ok" title={`${mode}: ${means}`}>
        {mode}
        <span className={styles['hidden']}>{`, ${means}`}</span>
      </Chip>
      {resolved && held !== null && (
        <span className={styles['muted']}>
          {words('editor.fetched')}
          {longDate(held.provenance.at)}
        </span>
      )}
      <span className={styles['acts']}>
        {onProvenance && resolved && held !== null && (
          <IconButton
            label={words('editor.provenance')}
            onClick={(event) => onProvenance(event.currentTarget)}
          >
            <Icon name="Provenance" />
          </IconButton>
        )}
        {onChange && (
          <IconButton label={words('editor.change')} onClick={onChange}>
            <Icon name="Change" />
          </IconButton>
        )}
        {held?.keepable === true && onKeep && (
          <IconButton label={words('editor.keep')} onClick={onKeep}>
            <Icon name="Keep" />
          </IconButton>
        )}
        {held?.keepable !== true && onResolve && (
          <IconButton label={words('editor.resolve')} onClick={onResolve}>
            <Icon name="Resolve" />
          </IconButton>
        )}
        {revisable && (
          <IconButton
            label={table ? words('editor.revise-a-cell-by-hand') : words('editor.revise-by-hand')}
            onClick={() => onRevise('revise')}
          >
            <Icon name="Edit" />
          </IconButton>
        )}
        {revisable && standing && (
          <IconButton
            label={words('editor.withdraw-the-revision')}
            onClick={() => onRevise('withdraw')}
          >
            <Icon name="Undo" />
          </IconButton>
        )}
      </span>
    </section>
  );
}
