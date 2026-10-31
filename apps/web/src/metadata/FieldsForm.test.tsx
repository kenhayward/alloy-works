import type { FieldView } from '@alloy-works/api-client';
import type { Vocabulary } from '@alloy-works/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FieldsForm, type FieldsFormProps } from './FieldsForm.js';
import { VocabulariesContext } from './vocabularies.js';

const REVIEW = 'schema-review';
const SCHEMAS = [{ id: REVIEW, name: 'Review' }];
const PEOPLE = [
  { id: 'person-ada', name: 'Ada' },
  { id: 'person-grace', name: 'Grace' },
];

const fieldOf = (id: string, name: string, over: Partial<FieldView> = {}): FieldView => ({
  id,
  name,
  dataType: 'text',
  multiplicity: 'one',
  validation: {},
  required: false,
  requiredBy: [],
  fixed: false,
  fixedBy: [],
  ...over,
});

/** The form over values it holds itself, as the panel does, reporting each change it makes. */
function Held(
  props: Omit<FieldsFormProps, 'values' | 'onChange'> & {
    initial?: Record<string, unknown>;
    onChange?: (values: Record<string, unknown>) => void;
  },
) {
  const [values, setValues] = useState<Record<string, unknown>>(props.initial ?? {});
  return (
    <FieldsForm
      {...props}
      values={values}
      onChange={(next) => {
        setValues({ ...next });
        props.onChange?.({ ...next });
      }}
    />
  );
}

const base = { schemas: SCHEMAS, people: PEOPLE, readOnly: false, zone: 'Europe/London' };

describe('the fields form', () => {
  it('MET-021 shows a missing or invalid field as it arises, while authoring', async () => {
    const changed = vi.fn();
    render(
      <Held
        {...base}
        fields={[
          fieldOf('field-code', 'Code', {
            validation: { maxLength: 4 },
            required: true,
            requiredBy: [REVIEW],
          }),
        ]}
        onChange={changed}
      />,
    );
    const code = screen.getByRole('textbox', { name: /^Code/ });
    // Missing, and said so beside the field before anything is typed.
    expect(code).toBeRequired();
    expect(code).toHaveAccessibleDescription(/Code is required/);
    // Too long, said as it is typed, and announced; and handed on to be saved all the same.
    await userEvent.type(code, 'ABCDE');
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(code).toHaveAccessibleDescription(/Is longer than 4 characters/);
    expect(screen.getByRole('status')).toHaveTextContent('Code: Is longer than 4 characters');
    expect(changed).toHaveBeenLastCalledWith({ 'field-code': 'ABCDE' });
    // Put right, and the field says nothing.
    await userEvent.type(code, '{Backspace}');
    expect(code).toHaveAttribute('aria-invalid', 'false');
    expect(code).not.toHaveAccessibleDescription(/longer/);
  });

  it('names the schemas that require and fix a field, and keeps a fixed one read-only', () => {
    render(
      <Held
        {...base}
        initial={{ 'field-market': 'uk' }}
        fields={[
          fieldOf('field-owner', 'Owner', { required: true, requiredBy: [REVIEW] }),
          fieldOf('field-market', 'Market', { fixed: true, fixedBy: [REVIEW], default: 'uk' }),
        ]}
      />,
    );
    expect(screen.getByText('Required by Review')).toBeInTheDocument();
    const market = screen.getByRole('textbox', { name: /^Market/ });
    expect(market).toHaveAttribute('readonly');
    expect(market).toHaveValue('uk');
    expect(screen.getByText('Fixed by Review')).toBeInTheDocument();
  });

  it('keeps a number as typed and hands on only a number, in its one spelling', async () => {
    const changed = vi.fn();
    render(
      <Held
        {...base}
        fields={[fieldOf('field-dose', 'Dose', { dataType: 'number' })]}
        onChange={changed}
      />,
    );
    const dose = screen.getByRole('textbox', { name: /^Dose/ });
    await userEvent.type(dose, '1.50');
    expect(dose).toHaveValue('1.50');
    expect(changed).toHaveBeenLastCalledWith({ 'field-dose': '1.5' });
    // Not a number: kept as typed, said beside it, and nothing that is not a number handed on.
    await userEvent.clear(dose);
    await userEvent.type(dose, 'lots');
    expect(dose).toHaveValue('lots');
    expect(dose).toHaveAccessibleDescription(/Enter a number, such as 12.5/);
    expect(changed).toHaveBeenLastCalledWith({ 'field-dose': null });
  });

  it('takes a switch, a date, a time and a person', async () => {
    const changed = vi.fn();
    render(
      <Held
        {...base}
        fields={[
          fieldOf('field-final', 'Final', { dataType: 'boolean' }),
          fieldOf('field-due', 'Due', { dataType: 'date' }),
          fieldOf('field-at', 'At', { dataType: 'time' }),
          fieldOf('field-owner', 'Owner', { dataType: 'user' }),
        ]}
        onChange={changed}
      />,
    );
    await userEvent.click(screen.getByRole('switch', { name: /^Final/ }));
    expect(changed).toHaveBeenLastCalledWith({ 'field-final': true });
    await userEvent.type(screen.getByLabelText(/^Due/), '2026-10-01');
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ 'field-due': '2026-10-01' }),
    );
    await userEvent.type(screen.getByLabelText(/^At/), '09:30');
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ 'field-at': '09:30' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Owner/ }), 'Grace');
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ 'field-owner': { user: 'person-grace' } }),
    );
  });

  it('shows a person no longer in the environment by that, keeping the value', () => {
    render(
      <Held
        {...base}
        initial={{ 'field-owner': { user: 'person-gone' } }}
        fields={[fieldOf('field-owner', 'Owner', { dataType: 'user' })]}
      />,
    );
    const owner = screen.getByRole('combobox', { name: /^Owner/ });
    expect(owner).toHaveDisplayValue('Someone no longer here');
  });

  it('stores a date and time as its instant, refusing one the zone skips and asking of one it repeats', async () => {
    const changed = vi.fn();
    render(
      <Held
        {...base}
        fields={[fieldOf('field-when', 'When', { dataType: 'dateTime' })]}
        onChange={changed}
      />,
    );
    const when = screen.getByLabelText(/^When/);
    await userEvent.type(when, '2026-07-15T09:30');
    expect(changed).toHaveBeenLastCalledWith({ 'field-when': '2026-07-15T09:30+01:00' });
    await userEvent.clear(when);
    await userEvent.type(when, '2026-03-29T01:30');
    expect(when).toHaveAccessibleDescription(
      /There is no 01:30 on 29 March 2026 here: the clocks go forward past it/,
    );
    await userEvent.clear(when);
    await userEvent.type(when, '2026-10-25T01:30');
    const which = screen.getByRole('radiogroup', {
      name: /01:30 on 25 October 2026 happens twice/,
    });
    await userEvent.click(within(which).getByRole('radio', { name: /The second, at UTC\+00:00/ }));
    expect(changed).toHaveBeenLastCalledWith({ 'field-when': '2026-10-25T01:30+00:00' });
  });

  it('keeps a list of values in order, adding, moving and removing', async () => {
    const changed = vi.fn();
    render(
      <Held
        {...base}
        initial={{ 'field-sites': ['Leeds', 'York'] }}
        fields={[fieldOf('field-sites', 'Sites', { multiplicity: 'many', maxValues: 3 })]}
        onChange={changed}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Move York up' }));
    expect(changed).toHaveBeenLastCalledWith({ 'field-sites': ['York', 'Leeds'] });
    await userEvent.click(screen.getByRole('button', { name: 'Add to Sites' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Sites, value 3' }), 'Hull');
    expect(changed).toHaveBeenLastCalledWith({ 'field-sites': ['York', 'Leeds', 'Hull'] });
    await userEvent.click(screen.getByRole('button', { name: 'Remove Leeds' }));
    expect(changed).toHaveBeenLastCalledWith({ 'field-sites': ['York', 'Hull'] });
  });

  it('moves what each box shows with its value when a list of numbers is reordered', async () => {
    render(
      <Held
        {...base}
        initial={{ 'field-doses': ['1.5', '2'] }}
        fields={[fieldOf('field-doses', 'Doses', { dataType: 'number', multiplicity: 'many' })]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Move 2 up' }));
    expect(screen.getByRole('textbox', { name: 'Doses, value 1' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'Doses, value 2' })).toHaveValue('1.5');
  });

  it('offers nothing to change when read-only', () => {
    render(<Held {...base} readOnly fields={[fieldOf('field-code', 'Code')]} />);
    expect(screen.getByRole('textbox', { name: /^Code/ })).toHaveAttribute('readonly');
  });
});

const REGION = 'c3d4e5f6-0000-4000-8000-0000000000a1';
const SITE = 'c3d4e5f6-0000-4000-8000-0000000000a2';

const valueOf = (
  id: string,
  label: string,
  rest: { state?: 'deprecated' | 'retired'; replacedBy?: string; description?: string } = {},
): Vocabulary['values'][number] => ({
  id,
  labels: [{ language: 'en', text: label }],
  descriptions: rest.description === undefined ? [] : [{ language: 'en', text: rest.description }],
  state: rest.state ?? 'active',
  ...(rest.replacedBy === undefined ? {} : { replacedBy: rest.replacedBy }),
});

const VOCABULARIES: Record<string, Vocabulary> = {
  [REGION]: {
    schemaVersion: 1,
    id: REGION,
    name: 'Region',
    key: 'region',
    base: 'en',
    order: 'declared',
    values: [
      valueOf('north', 'North', { description: 'Above the river' }),
      valueOf('west', 'West', { state: 'retired' }),
      valueOf('south', 'South'),
      valueOf('east', 'East', { state: 'deprecated', replacedBy: 'north' }),
    ],
  },
  // More than twenty, so searched rather than listed.
  [SITE]: {
    schemaVersion: 1,
    id: SITE,
    name: 'Site',
    key: 'site',
    base: 'en',
    order: 'declared',
    values: Array.from({ length: 25 }, (_, n) => valueOf(`s${n + 1}`, `Site ${n + 1}`)),
  },
};

/** The form beneath a page's vocabularies, as a document's or a component's page gives them. */
const withVocabularies = (ui: React.ReactElement) =>
  render(
    <VocabulariesContext.Provider value={async (id) => VOCABULARIES[id]}>
      {ui}
    </VocabulariesContext.Provider>,
  );

const regionField = (over: Partial<FieldView> = {}) =>
  fieldOf('field-region', 'Region', { validation: { vocabulary: REGION }, ...over });

const regionsField = () =>
  fieldOf('field-regions', 'Regions', { multiplicity: 'many', validation: { vocabulary: REGION } });

describe('a field drawing on a vocabulary', () => {
  it('MET-003 offers its values to choose from, by label and in its order, rather than free text', async () => {
    const changed = vi.fn();
    withVocabularies(<Held {...base} fields={[regionField()]} onChange={changed} />);
    const region = await screen.findByRole('combobox', { name: 'Region' });
    expect(
      within(region)
        .getAllByRole('option')
        .map((each) => each.textContent),
    ).toEqual(['No value', 'North', 'South', 'East (deprecated)']);
    expect(screen.queryByRole('textbox', { name: 'Region' })).toBeNull();
    await userEvent.selectOptions(region, 'South');
    expect(changed).toHaveBeenLastCalledWith({ 'field-region': 'south' });
    // A clear handed on as every input hands one on.
    await userEvent.selectOptions(region, 'No value');
    expect(changed).toHaveBeenLastCalledWith({ 'field-region': null });
  });

  it('LIB-054 shows the description of the value chosen', async () => {
    withVocabularies(<Held {...base} fields={[regionField()]} />);
    const region = await screen.findByRole('combobox', { name: 'Region' });
    await userEvent.selectOptions(region, 'North');
    expect(region).toHaveAccessibleDescription(/Above the river/);
  });

  it('LIB-063 says at once that a value chosen is deprecated, and never offers a retired one', async () => {
    withVocabularies(<Held {...base} fields={[regionField()]} />);
    const region = await screen.findByRole('combobox', { name: 'Region' });
    expect(within(region).queryByRole('option', { name: /West/ })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('');
    await userEvent.selectOptions(region, 'East (deprecated)');
    // Announced, and said beside the field, not only shown.
    expect(screen.getByRole('status')).toHaveTextContent('East is deprecated: use North instead');
    expect(region).toHaveAccessibleDescription(/Deprecated, replaced by North/);
  });

  it('LIB-055 names the replacement of a deprecated value held, and takes it', async () => {
    const changed = vi.fn();
    withVocabularies(
      <Held
        {...base}
        initial={{ 'field-region': 'east' }}
        fields={[regionField()]}
        onChange={changed}
      />,
    );
    const region = await screen.findByRole('combobox', { name: 'Region' });
    expect(region).toHaveDisplayValue('East (deprecated)');
    expect(region).toHaveAccessibleDescription(/Deprecated, replaced by North/);
    await userEvent.click(screen.getByRole('button', { name: 'Use replacement, North' }));
    expect(changed).toHaveBeenLastCalledWith({ 'field-region': 'north' });
    expect(region).toHaveDisplayValue('North');
    expect(screen.queryByRole('button', { name: /Use replacement/ })).toBeNull();
  });

  it('LIB-063 marks a retired value held by its label, and an id the vocabulary lacks as unknown', async () => {
    withVocabularies(
      <Held
        {...base}
        initial={{ 'field-region': 'west', 'field-regions': ['central'] }}
        fields={[regionField(), regionsField()]}
      />,
    );
    const region = await screen.findByRole('combobox', { name: 'Region' });
    expect(region).toHaveDisplayValue('West (retired)');
    expect(region).toHaveAccessibleDescription(/Retired: no longer offered/);
    expect(within(region).getByRole('option', { name: 'West (retired)' })).toBeDisabled();
    const held = screen.getByRole('combobox', { name: 'Regions, value 1' });
    expect(held).toHaveDisplayValue('central (unknown)');
    expect(held).toHaveAccessibleDescription(/Not a value of its vocabulary/);
  });

  it('holds several values, each chosen, and names each by its label', async () => {
    const changed = vi.fn();
    withVocabularies(
      <Held
        {...base}
        initial={{ 'field-regions': ['north'] }}
        fields={[regionsField()]}
        onChange={changed}
      />,
    );
    await screen.findByRole('combobox', { name: 'Regions, value 1' });
    await userEvent.click(screen.getByRole('button', { name: 'Add to Regions' }));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Regions, value 2' }),
      'South',
    );
    expect(changed).toHaveBeenLastCalledWith({ 'field-regions': ['north', 'south'] });
    await userEvent.click(screen.getByRole('button', { name: 'Remove North' }));
    expect(changed).toHaveBeenLastCalledWith({ 'field-regions': ['south'] });
  });

  it('searches a vocabulary of more than twenty values as it is typed, chosen by the keyboard', async () => {
    const changed = vi.fn();
    withVocabularies(
      <Held
        {...base}
        fields={[fieldOf('field-site', 'Site', { validation: { vocabulary: SITE } })]}
        onChange={changed}
      />,
    );
    const site = await screen.findByRole('combobox', { name: 'Site' });
    expect(site.tagName).toBe('INPUT');
    await userEvent.type(site, 'site 2');
    const offered = screen.getByRole('listbox', { name: 'Site' });
    expect(within(offered).getAllByRole('option')).toHaveLength(7);
    await userEvent.type(site, '4');
    expect(
      within(offered)
        .getAllByRole('option')
        .map((each) => each.textContent),
    ).toEqual(['Site 24']);
    expect(site).toHaveAttribute('aria-activedescendant', within(offered).getByRole('option').id);
    await userEvent.keyboard('{Enter}');
    expect(changed).toHaveBeenLastCalledWith({ 'field-site': 's24' });
    expect(site).toHaveValue('Site 24');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the label, not the id, when read-only', async () => {
    withVocabularies(
      <Held {...base} readOnly initial={{ 'field-region': 'south' }} fields={[regionField()]} />,
    );
    const region = await screen.findByRole('combobox', { name: 'Region' });
    expect(region).toHaveDisplayValue('South');
    expect(region).toBeDisabled();
  });
});
