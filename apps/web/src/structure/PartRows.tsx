import type { OutlineViewNode } from '@alloy-works/domain';
import type { ReactNode } from 'react';

import { Icon } from '../editor/Icon.js';
import { Lozenge } from '../states/Lozenge.js';
import { statusWords, translationKind } from '../translation/Translations.js';
import { words as say } from '../words/words.js';
import { editableSaid, type Standing } from './DocumentText.js';
import part from './PartPanel.module.css';
import { presenceWords } from './PeopleHere.js';
import { nodeName } from './tree.js';
import { VersionChoice, VersionRow, versionSaid, type Choosing } from './VersionChoice.js';

/** The acts offered from the rows, given only where they may be done. */
export interface PartActs {
  readonly choosing?: Choosing | undefined;
  /** The Overrides icon stands in the panel's head, so a plain "overridden here" need not be said. */
  readonly overridesInHead?: boolean | undefined;
  readonly onSuggest?: ((node: string) => void) | undefined;
  /** The part a suggestion is being drafted in: none is offered there again. */
  readonly drafting?: string | null | undefined;
}

/** A row of the list: an icon, then what is true, each in as many lines as it needs. */
function Row({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <li className={part['fact']}>
      <Icon name={icon} size={14} />
      <span className={part['factValue']}>{children}</span>
    </li>
  );
}

/**
 * **What is true of a part, as a list** (part-panel-2, decision 1; the EP plan, EP4; CNT-162, LIF-018,
 * LIF-046, LOC-016, REU-015): its version first, as a menu where it may be chosen, then its line, its
 * translations, review and overrides, who may edit it and who is here. A state stays a `Lozenge`, in the
 * row's value. An override that no longer applies is said here to everyone, the head's badge or not.
 */
export function PartRows({
  node,
  standing,
  acts = {},
}: {
  node: OutlineViewNode;
  standing: Standing;
  acts?: PartActs;
}) {
  const { names, changed, movedParts, resolved, revisions, lines, diverged, translated } = standing;
  const { pastReview, overridesOf, editable, openComponent, present, threadCounts } = standing;
  if (node.type !== 'reference') return null;
  const name = nodeName(node, names);
  const overrides = overridesOf?.get(node.id) ?? [];
  const number = resolved?.get(node.id);
  const revision = revisions?.get(node.id);
  const said = versionSaid(node.mode, number, revision);
  const openHere =
    openComponent !== null && openComponent !== undefined && openComponent === node.component;
  const editableWords = editableSaid(editable?.get(node.id), openHere);
  const threads = threadCounts?.get(node.id) ?? 0;
  const pending = editable?.get(node.id)?.pendingSuggestions ?? 0;
  return (
    <ul className={part['factList']}>
      {changed?.has(node.id) === true && (
        <Row icon="Edit">{say('document.changed-by-the-assistant')}</Row>
      )}
      {node.component === null ? (
        movedParts?.includes(node.id) === true && (
          <Row icon="Go to">{say('moving.part-moved-with-threads')}</Row>
        )
      ) : (
        <>
          <li className={part['factVersion']}>
            {acts.choosing ? (
              <VersionChoice
                node={node}
                component={node.component}
                name={name}
                said={said}
                number={number}
                revision={revision}
                choosing={acts.choosing}
              />
            ) : (
              <VersionRow mode={node.mode} number={number} revision={revision} />
            )}
          </li>
          {lines?.has(node.id) === true && (
            <Row icon="Versions">{say('document.line', { value1: lines.get(node.id) })}</Row>
          )}
          {lines?.has(node.id) !== true && (diverged?.get(node.id)?.length ?? 0) > 0 && (
            <Row icon="Versions">
              <Lozenge kind="diverged" size="small">
                {say('document.main-line-also', { value1: diverged!.get(node.id)!.join(', ') })}
              </Lozenge>
            </Row>
          )}
          {(translated?.get(node.id) ?? []).map((each) => (
            <Row key={each.language} icon="Language">
              <Lozenge kind={translationKind(each.status)} size="small">
                {`${each.language}: ${statusWords(each)}`}
              </Lozenge>
            </Row>
          ))}
          {pastReview?.has(node.id) === true && (
            <Row icon="Go to a date">
              <Lozenge kind="pastReview" size="small" />
            </Row>
          )}
          {acts.overridesInHead !== true && overrides.some((each) => !each.stale) && (
            <Row icon="Override">{say('document.overridden-here')}</Row>
          )}
          {overrides.some((each) => each.stale) && (
            <li className={part['fact']} data-warn="">
              <Icon name="Override" size={14} />
              <span className={part['factValue']}>
                {say('document.override-no-longer-applies')}
              </span>
            </li>
          )}
          {editableWords !== null && <Row icon="View">{editableWords}</Row>}
          {(present?.get(node.component) ?? []).length > 0 && (
            <Row icon="Readers">
              {present!
                .get(node.component)!
                .map((person) => presenceWords(person))
                .join('; ')}
            </Row>
          )}
          {threads > 0 && (
            <Row icon="Threads">
              <span data-threads={threads}>{say('document.threads-2', { count: threads })}</span>
            </Row>
          )}
          {pending > 0 && (
            <Row icon="Suggestions">{say('document.suggestions-2', { count: pending })}</Row>
          )}
          {acts.onSuggest &&
            editable?.get(node.id)?.maySuggest === true &&
            acts.drafting !== node.id && (
              <li className={part['factVersion']}>
                <button
                  type="button"
                  className={part['factAct']}
                  onClick={() => acts.onSuggest!(node.id)}
                  aria-label={say('document.suggest-changes-to', { value1: name })}
                >
                  <Icon name="Suggestions" size={14} />
                  <span className={part['factValue']}>{say('document.suggest-changes')}</span>
                  <Icon name="Go to" size={12} />
                </button>
              </li>
            )}
        </>
      )}
    </ul>
  );
}
