import type { AnyBinding } from '@alloy-works/domain';
import { useId, type Ref } from 'react';

import { queryDefinitionLink } from '../data/links.js';
import { longDate } from '../data/shapes.js';
import { Chip } from '../parts/Chip.js';
import { IconButton } from '../parts/IconButton.js';
import type { BindingState } from '../structure/bindingContexts.js';
import { Icon } from './Icon.js';
import styles from './ValuePanel.module.css';

/** Each mode's word on its chip, and the rest of what it means, said after it and in its title. */
const MODES = {
  checked: ['Checked', 'looked for each time the document is opened'],
  pinned: ['Pinned', 'never looked for'],
} as const;

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
  ref,
  stacked = false,
}: ValuePanelProps) {
  const heading = useId();
  const unreadable = 'a query definition you cannot read';
  const named =
    state !== undefined
      ? (state.definition?.title ?? null)
      : title === undefined
        ? undefined
        : (title ?? null);
  const version = state?.definition?.version;
  const held = state?.held ?? null;
  const [mode, means] = MODES[binding.mode];
  return (
    <section
      ref={ref}
      className={stacked ? `${styles['line']} ${styles['stacked']}` : styles['line']}
      aria-labelledby={heading}
      tabIndex={-1}
    >
      <h3 id={heading} className={styles['hidden']}>
        Value
      </h3>
      <span className={styles['glyph']} aria-hidden="true">
        <Icon name="Value" />
      </span>
      {named !== undefined && (
        <span className={styles['named']}>
          {named === null ? unreadable : <a href={queryDefinitionLink(binding.query)}>{named}</a>}
          {version !== undefined && <span className={styles['mono']}>{` version ${version}`}</span>}
        </span>
      )}
      <span className={styles['shown']}>{shown}</span>
      <Chip tone="ok" title={`${mode}: ${means}`}>
        {mode}
        <span className={styles['hidden']}>{`, ${means}`}</span>
      </Chip>
      {resolved && held !== null && (
        <span className={styles['muted']}>Fetched {longDate(held.provenance.at)}</span>
      )}
      <span className={styles['acts']}>
        {onProvenance && resolved && held !== null && (
          <IconButton label="Provenance" onClick={(event) => onProvenance(event.currentTarget)}>
            <Icon name="Provenance" />
          </IconButton>
        )}
        {onChange && (
          <IconButton label="Change" onClick={onChange}>
            <Icon name="Change" />
          </IconButton>
        )}
        {held?.keepable === true && onKeep && (
          <IconButton label="Keep" onClick={onKeep}>
            <Icon name="Keep" />
          </IconButton>
        )}
        {held?.keepable !== true && onResolve && (
          <IconButton label="Resolve" onClick={onResolve}>
            <Icon name="Resolve" />
          </IconButton>
        )}
      </span>
    </section>
  );
}
