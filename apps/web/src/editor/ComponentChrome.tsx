import type { createApiClient } from '@alloy-works/api-client';
import { useRef, type ComponentProps, type ReactNode } from 'react';

import { ArchiveButton } from '../lifecycle/Archive.js';
import { DatesButton } from '../lifecycle/Dates.js';
import { DeleteButton } from '../lifecycle/Delete.js';
import { PlaceHoldButton } from '../lifecycle/Hold.js';
import { ScopeButton } from '../lifecycle/Scope.js';
import { UsedInButton } from '../reuse/UsedIn.js';
import { RelationshipsButton } from '../reuse/Relationships.js';
import { MoveDialog } from '../lifecycle/MoveDialog.js';
import type { CommandState, StyleItem } from '../shell/commands/menus.js';
import { DocumentHeader } from '../structure/DocumentHeader.js';
import { words as say } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;
type Dates = ComponentProps<typeof DatesButton>['dates'];
type Scope = ComponentProps<typeof ScopeButton>['scope'];

const opening = (act: { current: (() => void) | null }, enabled = true): CommandState => ({
  enabled,
  run: () => act.current?.(),
});

/**
 * A component's part of the one header on its own page, and the dialogs its Component menu opens, no
 * buttons (ADR-0085): as a document's, from the facts the editor holds. Drawn by the editor, since they
 * live in it, through the header's own slots.
 */
export function ComponentChrome({
  client,
  id,
  space,
  title,
  titleField,
  version,
  versionTitle,
  beside,
  transition,
  tools,
  dates,
  scope,
  archived,
  mayEdit,
  mayMove,
  mayRetire,
  mayHold,
  editorState,
  editorStyles,
  pageState,
  onShowAttributes,
  onDates,
  onScope,
  onMoved,
  onArchived,
  onDeleted,
  onHeld,
}: {
  client: Client;
  id: string;
  space: { readonly id: string; readonly name: string };
  title: string;
  /** The title, edited where it stands. */
  titleField: ReactNode;
  version: string;
  versionTitle?: string | undefined;
  beside: ReactNode;
  transition: ComponentProps<typeof DocumentHeader>['transition'];
  /** The mode, from the page. */
  tools: ReactNode;
  dates: Dates | undefined;
  scope: Scope;
  archived: boolean;
  mayEdit: boolean;
  mayMove: boolean;
  mayRetire: boolean;
  mayHold: boolean;
  /** How an editor command stands, from what the editor publishes. */
  editorState: (id: string) => CommandState | undefined;
  editorStyles: () => readonly StyleItem[];
  /** How a command of the page's stands: its modes, its panels. */
  pageState: (id: string) => CommandState | undefined;
  /** Language, direction and lines are set in the Attributes panel. */
  onShowAttributes: () => void;
  onDates: (dates: Dates) => void;
  onScope: (scope: Scope) => void;
  onMoved: (said: string) => void;
  onArchived: (archived: boolean, said: string) => void;
  onDeleted: () => void;
  onHeld: (said: string) => void;
}) {
  const datesAct = useRef<() => void>(null);
  const scopeAct = useRef<() => void>(null);
  const usedInAct = useRef<() => void>(null);
  const relationshipsAct = useRef<() => void>(null);
  const moveAct = useRef<() => void>(null);
  const holdAct = useRef<() => void>(null);
  const archiveAct = useRef<() => void>(null);
  const deleteAct = useRef<() => void>(null);
  const showAttributes: CommandState = { enabled: true, run: onShowAttributes };

  const stateOf = (command: string): CommandState => {
    const fromEditor = editorState(command) ?? pageState(command);
    if (fromEditor !== undefined) return fromEditor;
    switch (command) {
      case 'dates':
        return opening(datesAct, mayEdit && !archived && dates !== undefined);
      case 'scope':
        return opening(scopeAct);
      case 'language':
      case 'lines':
        return showAttributes;
      case 'used-in':
        return opening(usedInAct);
      case 'relationships':
        return opening(relationshipsAct);
      case 'move':
        return opening(moveAct, mayMove && !archived);
      case 'hold':
        return opening(holdAct, mayHold);
      case 'archive':
        return {
          ...opening(archiveAct, mayRetire),
          said: archived ? say('lifecycle.unarchive') : say('lifecycle.archive'),
        };
      case 'delete':
        return opening(deleteAct, mayRetire);
      default:
        return { enabled: false, run: () => undefined };
    }
  };

  return (
    <>
      <DocumentHeader
        kind="component"
        client={client}
        accessTarget={`artifact:${id}`}
        accessHref={`#/components/${id}/access`}
        listHref="#/components"
        title={title}
        titleField={titleField}
        space={space.name}
        version={version}
        versionTitle={versionTitle}
        beside={beside}
        transition={transition}
        mode={tools}
        preview={null}
        stateOf={stateOf}
        styles={editorStyles}
        onKeys={{}}
      />
      {dates !== undefined && (
        <DatesButton
          act={datesAct}
          client={client}
          kind="component"
          id={id}
          title={title}
          dates={dates}
          onSaved={onDates}
        />
      )}
      <ScopeButton
        act={scopeAct}
        mayEdit={mayEdit && !archived}
        client={client}
        kind="component"
        id={id}
        title={title}
        scope={scope}
        onSaved={onScope}
      />
      <UsedInButton act={usedInAct} client={client} id={id} title={title} />
      <RelationshipsButton
        act={relationshipsAct}
        client={client}
        id={id}
        kind="component"
        title={title}
      />
      <MoveDialog
        act={moveAct}
        client={client}
        id={id}
        from={space.id}
        carries={false}
        onChanged={onMoved}
      />
      <ArchiveButton
        act={archiveAct}
        client={client}
        kind="component"
        id={id}
        title={title}
        archived={archived}
        mayRetire={mayRetire}
        onChanged={onArchived}
      />
      <DeleteButton
        act={deleteAct}
        client={client}
        kind="component"
        id={id}
        title={title}
        mayRetire={mayRetire}
        onDeleted={onDeleted}
      />
      <PlaceHoldButton
        act={holdAct}
        client={client}
        target={{ artifact: id }}
        title={title}
        mayHold={mayHold}
        onPlaced={onHeld}
      />
    </>
  );
}
