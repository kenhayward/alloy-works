import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useRef, useState } from 'react';

import {
  shellClass,
  ShellLayout,
  ShellPage,
  ShellPanels,
  ShellPanelsEdge,
  ShellSideDock,
  ShellStartEdge,
  ShellText,
  useDockRoom,
} from '../layouts/AuthoringShell.js';
import { keep, kept, PaneSeparator, usePaneWidth } from '../layouts/PaneWidth.js';
import { ModeSwitch } from '../parts/ModeSwitch.js';
import { NameTip } from '../parts/NameTip.js';
import { PanelRail } from '../parts/PanelRail.js';
import { panelIds, panelLabel, panelsFor, type PanelKey } from '../parts/panels.js';
import { usePanelChoice } from '../parts/usePanelChoice.js';
import type { CommandState } from '../shell/commands/menus.js';
import { OPEN_SEARCH } from '../shell/CommandPalette.js';
import { StatusTools } from '../shell/Status.js';
import { ZoomControl } from '../theme/Canvas.js';
import { PresentationProvider } from '../theme/presentation.js';
import { words as say } from '../words/words.js';
import { InPlaceSettings } from './ActiveEditor.js';
import { ComponentEditor, type Mine } from './ComponentEditor.js';
import styles from './ComponentPage.module.css';
import { Icon } from './Icon.js';
import { InPlaceBand } from './InPlaceBand.js';
import { SpacePane } from './SpacePane.js';
import { VersionsPanel } from './VersionsPanel.js';

type Client = ReturnType<typeof createApiClient>;
type Mode = 'reading' | 'authoring';

/** The space pane beside an open component: dragged as the document's outline is. */
const SPACE_PANE = { storageKey: 'aw.component.space', min: 200, max: 480, initial: 260 };
/** The panels beside it, and the same while they offer the Table tab (ADR-0052). */
const DOCK_PANE = { storageKey: 'aw.component.panels', min: 280, max: 640, initial: 320 };
const TABLE_PANE = { storageKey: 'aw.component.table', min: 360, max: 720, initial: 440 };

/** Each kept apart from a document's, so that reading one does not open the next component read-only. */
export const COMPONENT_DOCK_KEY = 'aw.component.dock';
export const COMPONENT_MODE_KEY = 'aw.component.mode';

const ids = panelIds('component');
const MODES = (): readonly { readonly mode: Mode; readonly name: string }[] => [
  { mode: 'reading', name: say('document.reading') },
  { mode: 'authoring', name: say('document.authoring') },
];

/**
 * A component open on its own page, on the shell a document stands on (ADR-0085): the space pane, the
 * side dock and band, the text, and the panels that apply. The header and the menus are the editor's
 * to draw, since what they say lives in it.
 */
export function ComponentPage({
  client,
  principalId,
  id,
  line,
  linked,
}: {
  client: Client;
  principalId: string;
  id: string;
  line: string | undefined;
  linked: { readonly block: string; readonly arrival: number } | null;
}) {
  const spacePane = usePaneWidth(SPACE_PANE);
  const dockPane = usePaneWidth(DOCK_PANE);
  const tablePane = usePaneWidth(TABLE_PANE);
  const setDockArea = useDockRoom();
  const [band, setBand] = useState<HTMLElement | null>(null);
  const [selectionHost, setSelectionHost] = useState<HTMLElement | null>(null);
  const [selectionHeld, setSelectionHeld] = useState(false);
  const [fieldsHost, setFieldsHost] = useState<HTMLElement | null>(null);
  const [identityHost, setIdentityHost] = useState<HTMLElement | null>(null);
  const [tableHost, setTableHost] = useState<HTMLElement | null>(null);
  const [heldTable, setHeldTable] = useState({ holds: false, inHand: false });
  const [space, setSpace] = useState<{ readonly id: string; readonly name: string } | null>(null);
  // What the editor opened and shows now, for the Versions panel's My changes (CNT-113).
  const mineOf = useRef<(() => Mine) | null>(null);
  const [mayEdit, setMayEdit] = useState(false);
  const onMine = useCallback((mine: (() => Mine) | null) => {
    mineOf.current = mine;
    setMayEdit(mine?.().mayEdit === true);
  }, []);
  // How many versions have been restored: the editor opens afresh at each.
  const [restored, setRestored] = useState(0);
  const [chosenMode, setChosenMode] = useState<Mode>(() =>
    kept(COMPONENT_MODE_KEY) === 'reading' ? 'reading' : 'authoring',
  );
  const chooseMode = (mode: Mode) => {
    setChosenMode(mode);
    keep(COMPONENT_MODE_KEY, mode);
  };
  const modeNow: Mode = chosenMode === 'authoring' && mayEdit ? 'authoring' : 'reading';
  const [dock, setDock] = usePanelChoice(COMPONENT_DOCK_KEY, selectionHeld);
  const tabs = panelsFor({
    kind: 'component',
    mode: modeNow,
    holdsOwn: false,
    selectionHeld,
    tableHolds: heldTable.holds,
  });
  const shownDock: PanelKey = tabs.some((each) => each.key === dock) ? dock : 'part';
  const showPanel = (panel: PanelKey) => {
    setDock(panel);
    dockPane.setCollapsed(false);
  };
  const offered = mayEdit ? MODES() : MODES().filter(({ mode }) => mode === 'reading');

  const pageState = (command: string): CommandState | undefined => {
    switch (command) {
      case 'search':
        return { enabled: true, run: () => window.dispatchEvent(new CustomEvent(OPEN_SEARCH)) };
      case 'history':
        return { enabled: true, run: () => showPanel('versions') };
      case 'mode.reading':
      case 'mode.authoring': {
        const mode: Mode = command === 'mode.reading' ? 'reading' : 'authoring';
        return {
          enabled: offered.some((each) => each.mode === mode),
          checked: modeNow === mode,
          run: () => chooseMode(mode),
        };
      }
      case 'manage-styles':
        return {
          enabled: true,
          run: () => {
            window.location.hash = '#/admin/themes';
          },
        };
      case 'whats-new':
        return {
          enabled: true,
          run: () => {
            window.location.hash = '#/admin/about';
          },
        };
      default:
        return undefined;
    }
  };

  const label = (key: PanelKey) =>
    panelLabel(
      tabs.find((each) => each.key === key)!,
      'component',
    );
  return (
    // A component on its own is set in the environment's theme and layout (themes.md, ET-A).
    <PresentationProvider client={client}>
      {/* In the status bar (ADR-0056), as a document's is. */}
      <StatusTools>
        <ZoomControl />
      </StatusTools>
      <InPlaceSettings.Provider value={{ host: selectionHost, onHeld: setSelectionHeld }}>
        <InPlaceBand.Provider value={band}>
          <ShellPage labelledBy="component-title">
            <ShellLayout
              startCollapsed={spacePane.collapsed}
              panelsCollapsed={dockPane.collapsed}
              startWidth={spacePane.width}
              // While it offers a Table tab, the pane is wider, and stays so as the cursor moves.
              panelsWidth={(heldTable.holds ? tablePane : dockPane).width}
            >
              <ShellSideDock>
                <div role="group" aria-label={say('editor.space-pane')}>
                  <NameTip name={say('editor.space')}>
                    <button
                      type="button"
                      className={shellClass.dockToggle}
                      aria-label={say('editor.space')}
                      aria-pressed={!spacePane.collapsed}
                      onClick={() => spacePane.setCollapsed(!spacePane.collapsed)}
                    >
                      <Icon name="Contents" size={18} />
                    </button>
                  </NameTip>
                </div>
                {modeNow === 'authoring' && (
                  <>
                    <span className={shellClass.dockRule} />
                    <div ref={setBand} data-inplace-band="" />
                  </>
                )}
              </ShellSideDock>
              {/* Placed as a document's outline is, by the shell's rules for a start pane. */}
              <div data-panel="">
                <div data-part="outline">
                  {space !== null && !spacePane.collapsed && (
                    <SpacePane client={client} space={space} current={id} />
                  )}
                </div>
              </div>
              <ShellPanels
                areaRef={setDockArea}
                label={say('editor.component-panels')}
                hidden={dockPane.collapsed}
                rail={
                  <PanelRail
                    label={say('editor.component-panels-2')}
                    listLabel={say('editor.component-panels')}
                    tabs={tabs.map((each) => {
                      const named = { ...each, label: panelLabel(each, 'component') };
                      return each.key === 'table' && heldTable.inHand && shownDock !== 'table'
                        ? { ...named, dot: true, name: say('editor.table-in-hand') }
                        : named;
                    })}
                    chosen={shownDock}
                    onChoose={(key) => setDock(key as PanelKey)}
                    ids={ids}
                    pane={dockPane}
                  />
                }
              >
                <h2 className={shellClass.dockHeading}>{label(shownDock)}</h2>
                <div
                  className={shellClass.dockBody}
                  data-dock-body=""
                  {...(shownDock === 'selection' ? { tabIndex: 0 } : {})}
                >
                  <div
                    id={ids('table').panel}
                    role="tabpanel"
                    aria-labelledby={ids('table').tab}
                    hidden={shownDock !== 'table'}
                    className={styles['panel']}
                  >
                    <div ref={setTableHost} />
                  </div>
                  <div
                    id={ids('selection').panel}
                    role="tabpanel"
                    aria-labelledby={ids('selection').tab}
                    hidden={shownDock !== 'selection'}
                    className={styles['panel']}
                  >
                    <div ref={setSelectionHost} />
                  </div>
                  {/* Kept mounted, so the fields keep what is being typed into them. */}
                  <div
                    id={ids('part').panel}
                    role="tabpanel"
                    aria-labelledby={ids('part').tab}
                    hidden={shownDock !== 'part'}
                    className={styles['panel']}
                  >
                    <div ref={setIdentityHost} className={styles['identity']} />
                    <div ref={setFieldsHost} />
                    <dl className={styles['facts']}>
                      <dt>{say('editor.identifier')}</dt>
                      <dd className={styles['mono']} data-content>
                        {id}
                      </dd>
                    </dl>
                  </div>
                  <div
                    id={ids('versions').panel}
                    role="tabpanel"
                    aria-labelledby={ids('versions').tab}
                    hidden={shownDock !== 'versions'}
                    className={styles['panel']}
                  >
                    {shownDock === 'versions' && (
                      <VersionsPanel
                        // Another line is another history: nothing previewed on one shows on the next.
                        key={line ?? ''}
                        client={client}
                        id={id}
                        line={line}
                        mine={() => mineOf.current?.() ?? null}
                        mayEdit={mayEdit}
                        onRestored={() => setRestored((count) => count + 1)}
                      />
                    )}
                  </div>
                </div>
              </ShellPanels>
              {!spacePane.collapsed && (
                <ShellStartEdge>
                  <PaneSeparator label={say('editor.space-pane')} pane={spacePane} />
                </ShellStartEdge>
              )}
              {!dockPane.collapsed && (
                <ShellPanelsEdge>
                  <PaneSeparator
                    label={say('editor.component-panels-2')}
                    pane={heldTable.holds ? tablePane : dockPane}
                    edge="end"
                  />
                </ShellPanelsEdge>
              )}
              <ShellText desk={false}>
                <ComponentEditor
                  // Reading has no session, so a change of mode opens it afresh (ruling 7).
                  key={`${line ?? ''}:${restored}:${chosenMode}`}
                  componentId={id}
                  line={line}
                  client={client}
                  principalId={principalId}
                  onSpace={setSpace}
                  linked={linked}
                  fieldsHost={fieldsHost}
                  tableHost={tableHost}
                  onTable={setHeldTable}
                  onMine={onMine}
                  ownPage={{
                    reading: chosenMode === 'reading',
                    tools: (
                      <ModeSwitch
                        group={`mode-${id}`}
                        offered={offered}
                        chosen={modeNow}
                        onChoose={chooseMode}
                      />
                    ),
                    identityHost,
                    pageState,
                    onShowAttributes: () => showPanel('part'),
                  }}
                />
              </ShellText>
            </ShellLayout>
          </ShellPage>
        </InPlaceBand.Provider>
      </InPlaceSettings.Provider>
    </PresentationProvider>
  );
}
