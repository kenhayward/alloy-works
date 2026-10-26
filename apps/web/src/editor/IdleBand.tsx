import styles from './ComponentEditor.module.css';
import { EditorToolbar, type ToolbarAct } from './EditorToolbar.js';
import { words } from '../words/words.js';

const nothing = () => undefined;

/** The acts a component open in place leads its toolbar with, none of them pressable yet. */
const IDLE_ACTS: readonly ToolbarAct[] = [
  {
    get label() {
      return words('editor.done-editing');
    },
    get icon() {
      return words('editor.done-editing');
    },
    disabled: true,
    onPress: nothing,
  },
  {
    get label() {
      return words('editor.save-version');
    },
    get icon() {
      return words('editor.save-version');
    },
    disabled: true,
    onPress: nothing,
  },
  {
    get label() {
      return words('editor.saved-text');
    },
    get icon() {
      return words('editor.saved-text');
    },
    disabled: true,
    onPress: nothing,
  },
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
        <p className={styles['bandHint']}>{words('editor.click-a-component-s-text')}</p>
      </div>
    </div>
  );
}
