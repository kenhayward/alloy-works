import styles from './ComponentEditor.module.css';
import { EditorToolbar, type ToolbarAct } from './EditorToolbar.js';

const nothing = () => undefined;

/** The acts a component open in place leads its toolbar with, none of them pressable yet. */
const IDLE_ACTS: readonly ToolbarAct[] = [
  { label: 'Done editing', icon: 'Done editing', disabled: true, onPress: nothing },
  { label: 'Save version', icon: 'Save version', disabled: true, onPress: nothing },
  { label: 'Saved text', icon: 'Saved text', disabled: true, onPress: nothing },
];

/**
 * The in-place band while no component is open (ADR-0056): the same toolbar, every button disabled,
 * and the second line saying how to open one. The same buttons in the same places, so opening a
 * component changes nothing in the band but what it may press.
 */
export function IdleBand() {
  return (
    <div className={styles['band']}>
      <EditorToolbar
        view={null}
        enabled={false}
        leading={IDLE_ACTS}
        newIdentifier={() => ''}
        prompt={() => Promise.resolve(null)}
        onPasteMarkdown={nothing}
        onInsertFigure={nothing}
        onInsertImage={nothing}
      />
      <div className={styles['toolbarLine']} data-toolbar-line="">
        <p className={styles['bandHint']}>Click a component&apos;s text to edit it.</p>
      </div>
    </div>
  );
}
