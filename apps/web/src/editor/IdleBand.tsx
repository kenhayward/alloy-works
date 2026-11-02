import { EditorToolbar } from './EditorToolbar.js';

const nothing = () => undefined;

/**
 * The dock's tools while no component is open (ADR-0075): the same tools, every one `aria-disabled`, so
 * opening a component changes nothing but what may be pressed.
 */
export function IdleBand({ onComment }: { onComment?: () => void }) {
  return (
    <EditorToolbar
      layout="dock"
      view={null}
      enabled={false}
      newIdentifier={() => ''}
      prompt={() => Promise.resolve(null)}
      onPasteMarkdown={nothing}
      onInsertFigure={nothing}
      onInsertImage={nothing}
      {...(onComment === undefined ? {} : { onComment })}
    />
  );
}
