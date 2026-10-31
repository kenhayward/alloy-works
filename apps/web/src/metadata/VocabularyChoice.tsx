import {
  valueDescription,
  valueLabel,
  valuesInOrder,
  type Vocabulary,
  type VocabularyValue,
} from '@alloy-works/domain';
import { useId, useState } from 'react';

import styles from './FieldsForm.module.css';
import { readerLanguage } from './vocabularies.js';
import { words } from '../words/words.js';

/** Past this many values offered, a box that searches them rather than a list of them all. */
const LISTED = 20;

/**
 * Where a deprecated value's replacements lead (LIB-055): followed to a value nothing replaces, which
 * the vocabulary's shape guarantees; nothing where that is retired, since it is never offered.
 */
export function replacementOf(
  vocabulary: Vocabulary,
  value: VocabularyValue,
): VocabularyValue | undefined {
  let next = value;
  for (let steps = 0; next.state === 'deprecated' && next.replacedBy !== undefined; steps += 1) {
    const found = vocabulary.values.find((each) => each.id === next.replacedBy);
    if (found === undefined || steps > vocabulary.values.length) return undefined;
    next = found;
  }
  return next === value || next.state === 'retired' ? undefined : next;
}

/** A value as it is offered or shown: its label, and its state where it is not active. */
function shownAs(vocabulary: Vocabulary, value: VocabularyValue, language: string): string {
  const label = valueLabel(vocabulary, value, language);
  return value.state === 'deprecated'
    ? words('metadata.value-deprecated', { label })
    : value.state === 'retired'
      ? words('metadata.value-retired', { label })
      : label;
}

export interface VocabularyChoiceProps {
  readonly id: string;
  /** The field's name, or its entry's, which names the list of values a search offers. */
  readonly name: string;
  readonly vocabulary: Vocabulary;
  readonly value: unknown;
  readonly readOnly: boolean;
  readonly aria: {
    readonly 'aria-required': boolean;
    readonly 'aria-invalid': boolean;
    readonly 'aria-describedby': string;
  };
  readonly onChange: (value: unknown) => void;
  /** Said at once, in the form's live region: choosing a deprecated value (LIB-063). */
  readonly onAnnounce: (said: string | null) => void;
}

/**
 * A text field drawing on a vocabulary, chosen rather than typed (the VO plan, VO-F; MET-003): its
 * active and deprecated values in its order, by label in the reader's language, a list up to twenty and
 * a box that searches them past that. A deprecated one is marked, its replacement named with Use
 * replacement, and choosing one is announced; a retired one is never offered but shown where held, and
 * an id the vocabulary lacks shown as itself, both marked. The chosen value's description is beside it.
 */
export function VocabularyChoice(props: VocabularyChoiceProps) {
  const { vocabulary } = props;
  const language = readerLanguage();
  const note = useId();
  const offered = valuesInOrder(vocabulary, language).filter((each) => each.state !== 'retired');
  const held = typeof props.value === 'string' && props.value !== '' ? props.value : undefined;
  const heldValue = vocabulary.values.find((each) => each.id === held);
  const replacement = heldValue === undefined ? undefined : replacementOf(vocabulary, heldValue);
  const labelOf = (value: VocabularyValue) => valueLabel(vocabulary, value, language);

  const said: string[] = [];
  if (held !== undefined && heldValue === undefined)
    said.push(words('metadata.not-a-value-of-its'));
  if (heldValue?.state === 'deprecated') {
    said.push(
      replacement === undefined
        ? words('metadata.deprecated')
        : words('metadata.deprecated-replaced-by', { replacement: labelOf(replacement) }),
    );
  }
  if (heldValue?.state === 'retired') said.push(words('metadata.retired-no-longer-offered'));
  const description =
    heldValue === undefined ? undefined : valueDescription(vocabulary, heldValue, language);

  const choose = (id: string | null) => {
    props.onChange(id);
    const chosen = vocabulary.values.find((each) => each.id === id);
    if (chosen?.state !== 'deprecated') {
      props.onAnnounce(null);
      return;
    }
    const instead = replacementOf(vocabulary, chosen);
    props.onAnnounce(
      instead === undefined
        ? words('metadata.is-deprecated', { label: labelOf(chosen) })
        : words('metadata.is-deprecated-use-instead', {
            label: labelOf(chosen),
            replacement: labelOf(instead),
          }),
    );
  };

  const shownHeld =
    held === undefined
      ? ''
      : heldValue === undefined
        ? words('metadata.value-unknown', { id: held })
        : shownAs(vocabulary, heldValue, language);
  const aria = {
    ...props.aria,
    'aria-describedby': `${props.aria['aria-describedby']} ${note}`,
  };

  return (
    <>
      {offered.length > LISTED ? (
        <SearchedChoice
          id={props.id}
          name={props.name}
          aria={aria}
          readOnly={props.readOnly}
          offered={offered}
          shown={shownHeld}
          optionText={(value) => shownAs(vocabulary, value, language)}
          labelOf={labelOf}
          descriptionOf={(value) => valueDescription(vocabulary, value, language)}
          language={language}
          onChoose={choose}
        />
      ) : (
        <select
          id={props.id}
          value={held ?? ''}
          disabled={props.readOnly}
          onChange={(event) => choose(event.target.value === '' ? null : event.target.value)}
          {...aria}
        >
          <option value="">{words('metadata.no-value')}</option>
          {held !== undefined && (heldValue === undefined || heldValue.state === 'retired') && (
            <option value={held} disabled>
              {shownHeld}
            </option>
          )}
          {offered.map((each) => (
            <option key={each.id} value={each.id}>
              {shownAs(vocabulary, each, language)}
            </option>
          ))}
        </select>
      )}
      <span id={note} className={styles['note']}>
        {[...said, ...(description === undefined ? [] : [description])].join('. ')}
      </span>
      {!props.readOnly && replacement !== undefined && (
        <button type="button" onClick={() => choose(replacement.id)}>
          {words('metadata.use-replacement', { replacement: labelOf(replacement) })}
        </button>
      )}
    </>
  );
}

/**
 * The values searched as they are typed: a combobox and its listbox, as the command palette's (the LG
 * plan, LG-G). The arrows move, Enter chooses, Escape puts back what is held; left empty, it holds
 * nothing. Nothing typed is ever handed on, only a value chosen.
 */
function SearchedChoice(props: {
  readonly id: string;
  readonly name: string;
  readonly aria: VocabularyChoiceProps['aria'];
  readonly readOnly: boolean;
  readonly offered: readonly VocabularyValue[];
  readonly shown: string;
  readonly optionText: (value: VocabularyValue) => string;
  readonly labelOf: (value: VocabularyValue) => string;
  readonly descriptionOf: (value: VocabularyValue) => string | undefined;
  readonly language: string;
  readonly onChoose: (id: string | null) => void;
}) {
  const list = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const sought = (typed ?? '').trim().toLocaleLowerCase(props.language);
  const found = props.offered.filter((each) =>
    props.labelOf(each).toLocaleLowerCase(props.language).includes(sought),
  );
  const at = Math.min(active, found.length - 1);
  const option = (index: number) => `${list}-${index}`;
  const shut = () => {
    setTyped(null);
    setOpen(false);
  };
  const choose = (value: VocabularyValue | undefined) => {
    if (value === undefined) return;
    shut();
    props.onChoose(value.id);
  };
  const listed = open && !props.readOnly && found.length > 0;
  return (
    <>
      <input
        id={props.id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listed}
        aria-controls={list}
        aria-activedescendant={listed ? option(at) : undefined}
        autoComplete="off"
        value={typed ?? props.shown}
        readOnly={props.readOnly}
        onChange={(event) => {
          setTyped(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => {
          if (typed !== null && typed.trim() === '') props.onChoose(null);
          shut();
        }}
        onKeyDown={(event) => {
          if (props.readOnly) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              setActive(0);
              return;
            }
            if (found.length === 0) return;
            const by = event.key === 'ArrowDown' ? 1 : -1;
            setActive((at + by + found.length) % found.length);
          } else if (event.key === 'Enter') {
            if (listed) {
              event.preventDefault();
              choose(found[at]);
            } else if (typed !== null && typed.trim() === '') {
              event.preventDefault();
              shut();
              props.onChoose(null);
            }
          } else if (event.key === 'Escape' && (open || typed !== null)) {
            event.preventDefault();
            shut();
          }
        }}
        {...props.aria}
      />
      {listed && (
        <ul id={list} role="listbox" aria-label={props.name} className={styles['options']}>
          {found.map((each, index) => {
            const description = props.descriptionOf(each);
            return (
              <li
                key={each.id}
                id={option(index)}
                role="option"
                aria-selected={index === at}
                className={styles['option']}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(each)}
              >
                {props.optionText(each)}
                {description !== undefined && (
                  <span className={styles['note']}>{` ${description}`}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
