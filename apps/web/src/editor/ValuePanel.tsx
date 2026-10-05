import type { Binding } from '@alloy-works/domain';
import { useId, type Ref } from 'react';

import { longDate } from '../data/shapes.js';
import type { BindingState } from '../structure/bindingContexts.js';
import styles from './TablePanel.module.css';

const MODES = {
  checked: 'Checked - looked for each time the document is opened',
  pinned: 'Pinned - never looked for',
} as const;

export interface ValuePanelProps {
  /** The binding selected whole, as the component stores it. */
  readonly binding: Binding;
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
}

/**
 * **The Value panel** (the B1 plan, B1-M; bindings.md, "Keyboard and accessibility"), in the dock
 * beside the Figure and Table panels while a binding is selected whole: what it shows, its definition,
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
}: ValuePanelProps) {
  const heading = useId();
  const definition =
    state !== undefined
      ? state.definition === null
        ? 'a query definition you cannot read'
        : `${state.definition.title}, version ${state.definition.version}`
      : title === undefined
        ? null
        : (title ?? 'a query definition you cannot read');
  const held = state?.held ?? null;
  return (
    <section ref={ref} className={styles['panel']} aria-labelledby={heading} tabIndex={-1}>
      <h3 id={heading}>Value</h3>
      <span>{shown}</span>
      {definition !== null && <span>Query definition: {definition}</span>}
      <span>Mode: {MODES[binding.mode]}</span>
      {resolved && held !== null && <span>Fetched {longDate(held.provenance.at)}</span>}
      {onProvenance && resolved && held !== null && (
        <button type="button" onClick={(event) => onProvenance(event.currentTarget)}>
          Provenance
        </button>
      )}
      {onChange && (
        <button type="button" onClick={onChange}>
          Change
        </button>
      )}
      {held?.keepable === true && onKeep && (
        <button type="button" onClick={onKeep}>
          Keep
        </button>
      )}
      {held?.keepable !== true && onResolve && (
        <button type="button" onClick={onResolve}>
          Resolve
        </button>
      )}
    </section>
  );
}
