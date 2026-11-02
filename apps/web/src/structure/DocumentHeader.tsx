import { chordListener } from '@alloy-works/editor';
import { useEffect, useId, useState, type ReactNode } from 'react';

import { useAdministers } from '../access/ManageAccessLink.js';
import { Modal } from '../layouts/Modal.js';
import { useLifecycleActs, type LifecycleAct } from '../lifecycle/Workflow.js';
import { MenuBar } from '../parts/MenuBar.js';
import { HeaderSlot } from '../shell/HeaderSlot.js';
import { usePageShown } from '../shell/Status.js';
import { buildMenus, type CommandState, type StyleItem } from '../shell/commands/menus.js';
import { chordSaid, COMMANDS } from '../shell/commands/registry.js';
import { words as say } from '../words/words.js';
import { useZoom, ZOOMS, type Zoom } from '../theme/presentation.js';
import { useStyleLabels } from '../theme/styleLabels.js';
import styles from './DocumentHeader.module.css';

/** The document's states as a stepper (ADR-0075), the current one marked; the workflow's names. */
function Stepper({
  states,
  current,
  progress,
}: {
  states: readonly { readonly key: string; readonly name: string }[];
  current: { readonly key: string; readonly name: string };
  progress?: string | undefined;
}) {
  // Past five, or none known, the current state alone: a workflow is the tenant's, of any length.
  const shown = states.length > 0 && states.length <= 5 ? states : [current];
  return (
    <ol className={styles['stepper']} aria-label={say('document.lifecycle')}>
      {shown.map((state) => (
        <li
          key={state.key}
          className={styles['step']}
          {...(state.key === current.key ? { 'aria-current': 'step' as const } : {})}
          data-content
        >
          <span className={styles['dot']} aria-hidden="true" />
          {state.name}
        </li>
      ))}
      {progress !== undefined && <li className={styles['progress']}>{progress}</li>}
    </ol>
  );
}

/** Every key the registry holds, from the registry, so it cannot disagree with a menu (CNT-188). */
function KeyboardShortcuts({ onClose }: { onClose: () => void }) {
  const heading = useId();
  return (
    <Modal labelledBy={heading} onClose={onClose}>
      <h2 id={heading}>{say('menu.keyboard-shortcuts')}</h2>
      <table className={styles['keys']} aria-label={say('shell.keyboard-shortcuts-list')}>
        <tbody>
          {COMMANDS.filter((each) => each.chord !== undefined).map((each) => (
            <tr key={each.id}>
              <th scope="row">{each.said()}</th>
              <td>
                <kbd>{chordSaid(each.chord!)}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

type TransitionProps = Parameters<typeof useLifecycleActs>[0];

/** The lifecycle's acts, where the document has a standing. */
function WithLifecycle({
  transition,
  children,
}: {
  transition: TransitionProps;
  children: (acts: ReturnType<typeof useLifecycleActs>) => ReactNode;
}) {
  const acts = useLifecycleActs(transition);
  return (
    <>
      {children(acts)}
      {acts.dialogs}
    </>
  );
}

/** The next zoom along from `zoom`, or the same at the end; Fit counts as 100%. */
const zoomedBy = (zoom: Zoom, by: 1 | -1): Zoom => {
  const at = ZOOMS.indexOf(zoom === 'fit' ? 1 : zoom);
  return ZOOMS[at + by] ?? zoom;
};

/**
 * The document's part of the one header (ADR-0075): where it is, its menus, its lifecycle, its mode and
 * Preview. Menus are built as they are drawn, so what they say of the text is what it is as one opens.
 */
export function DocumentHeader({
  client,
  accessTarget,
  accessHref,
  title,
  space,
  version,
  beside,
  transition,
  mode,
  preview,
  stateOf,
  styles: paragraphStyles,
  onKeys,
}: {
  client: Parameters<typeof useAdministers>[0];
  accessTarget: string;
  accessHref: string;
  title: string;
  space: string;
  version: string;
  /** Who is here and the revision, at the end of the title's line. */
  beside: ReactNode;
  transition?: TransitionProps | undefined;
  mode: ReactNode;
  preview: ReactNode;
  stateOf: (id: string) => CommandState;
  styles: () => readonly StyleItem[];
  /** The page's own keys, by the registry's chords. */
  onKeys: Readonly<Record<string, () => boolean>>;
}) {
  const [listing, setListing] = useState(false);
  const shown = usePageShown();
  const zooming = useZoom();
  const [labelsOn, setLabelsOn] = useStyleLabels();
  const administers = useAdministers(client, accessTarget);
  useEffect(() => {
    if (!shown) return undefined;
    const zoomBy = (by: 1 | -1) => () => {
      if (zooming === null) return false;
      zooming.setZoom(zoomedBy(zooming.zoom, by));
      return true;
    };
    const listen = chordListener({
      ...onKeys,
      'Mod-Alt-=': zoomBy(1),
      'Mod-Alt--': zoomBy(-1),
    });
    const onKey = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && listen(event)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKeys, shown, zooming]);
  const headerState = (id: string): CommandState => {
    if (id === 'shortcuts') return { enabled: true, run: () => setListing(true) };
    if (id === 'style-labels') {
      return { enabled: true, checked: labelsOn, run: () => setLabelsOn(!labelsOn) };
    }
    if (id === 'access') {
      return {
        enabled: administers,
        run: () => {
          window.location.hash = accessHref;
        },
      };
    }
    if ((id === 'zoom-in' || id === 'zoom-out' || id === 'fit') && zooming !== null) {
      return {
        enabled: true,
        run: () =>
          zooming.setZoom(id === 'fit' ? 'fit' : zoomedBy(zooming.zoom, id === 'zoom-in' ? 1 : -1)),
      };
    }
    return stateOf(id);
  };
  const draw = (acts?: ReturnType<typeof useLifecycleActs>) => {
    const menus = () =>
      buildMenus(headerState, {
        lifecycle: (acts?.acts ?? []).map(({ key, label, enabled, run }) => ({
          key,
          label,
          enabled,
          run,
        })),
        styles: paragraphStyles(),
      });
    const standing = transition?.standing;
    return (
      <>
        <HeaderSlot name="lead">
          <div className={styles['titleLine']}>
            <nav aria-label={say('document.breadcrumb')} className={styles['trail']}>
              <a href="#/documents" data-content>
                {space}
              </a>
              <span aria-hidden="true">/</span>
            </nav>
            <h2 id="document-title" className={styles['title']} data-content>
              {title}
            </h2>
            <span className={styles['version']} data-content>
              {version}
            </span>
            {beside}
          </div>
          <MenuBar label={say('menu.bar')} menus={menus} />
        </HeaderSlot>
        <HeaderSlot name="lifecycle">
          {standing !== undefined && (
            <div className={styles['lifecycle']}>
              <Stepper
                states={standing.states ?? []}
                current={standing.state}
                progress={acts?.progress}
              />
              {acts?.primary !== undefined && (
                <button
                  type="button"
                  className={styles['primary']}
                  disabled={!acts.primary.enabled}
                  data-content
                  onClick={acts.primary.run}
                >
                  {acts.primary.label}
                </button>
              )}
            </div>
          )}
        </HeaderSlot>
        <HeaderSlot name="tools">
          {mode}
          {preview}
        </HeaderSlot>
      </>
    );
  };
  return (
    <>
      {transition === undefined ? (
        draw()
      ) : (
        <WithLifecycle transition={transition}>{draw}</WithLifecycle>
      )}
      {listing && <KeyboardShortcuts onClose={() => setListing(false)} />}
    </>
  );
}
