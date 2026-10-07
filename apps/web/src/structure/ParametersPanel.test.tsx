import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import {
  DOCUMENT,
  INTRODUCTION,
  RESULTS,
  item,
  open,
  outline,
  section,
  service,
} from './test/documentPage.js';

// A section's title is a ProseMirror view since equations 3, which scrolls its selection into view.
shimRangeMeasurement();

const feeds = { arguments: true };
const DECLARED = [
  { name: 'due', type: { base: 'date' }, required: true, list: false, changeable: false, feeds },
  {
    name: 'region',
    type: { base: 'text' },
    required: true,
    list: false,
    permitted: { values: ['North', 'South'] },
    changeable: false,
    feeds,
  },
  {
    name: 'reviewer',
    type: { base: 'text' },
    required: false,
    list: false,
    changeable: true,
    feeds,
  },
];
const MADE_WITH = { due: '2026-10-31', region: 'North', reviewer: 'Ada' };
const PARAMETERS = `/v1/documents/${DOCUMENT}/parameters`;

function withParameters() {
  return service(outline([section(INTRODUCTION, 'Introduction'), section(RESULTS, 'Results')]), {
    parameters: { declarations: DECLARED, values: MADE_WITH },
  });
}

const panel = () => screen.findByRole('region', { name: 'Parameters' });
const saves = (sent: { url: string; body: unknown }[]) =>
  sent.filter((each) => each.url === PARAMETERS && each.body !== undefined);

describe('the Parameters panel (the TP1 plan, TP1-I)', () => {
  it('TPL-020 shows each parameter with its value, and in its History each change with who made it and when', async () => {
    const fake = withParameters();
    open(fake.fetch);
    const shown = await panel();
    expect(within(shown).getByLabelText('due (required)')).toHaveValue('2026-10-31');
    expect(within(shown).getByLabelText('region (required)')).toHaveValue('North');
    expect(within(shown).getByLabelText('reviewer')).toHaveValue('Ada');

    const reviewer = within(shown).getByLabelText('reviewer');
    await userEvent.clear(reviewer);
    await userEvent.type(reviewer, 'Grace');
    await waitFor(() => expect(saves(fake.sent)).toHaveLength(1));

    await userEvent.click(within(shown).getByText('History'));
    const history = await within(shown).findByRole('list', { name: 'Changes to the parameters' });
    await waitFor(() => expect(within(history).getAllByRole('listitem')).toHaveLength(2));
    const [newest, first] = within(history).getAllByRole('listitem');
    expect(newest).toHaveTextContent(/^Version 0\.2, by Ada, .+: reviewer Grace$/);
    expect(first).toHaveTextContent(
      /^Version 0\.1, by Ada, .+: due 2026-10-31, region North, reviewer Ada$/,
    );
    expect(within(newest!).getByText(/18 Sep/)).toHaveAttribute(
      'datetime',
      '2026-09-18T09:00:00.000Z',
    );
  });

  it('saves a changeable parameter a pause after it is typed, whole, and leaves the fixed ones read only', async () => {
    const fake = withParameters();
    open(fake.fetch);
    const shown = await panel();
    expect(within(shown).getByLabelText('due (required)')).toHaveAttribute('readonly');
    expect(within(shown).getByLabelText('due (required)')).toHaveAccessibleDescription(
      'Fixed when the document was made.',
    );
    expect(within(shown).getByLabelText('region (required)')).toBeDisabled();

    await userEvent.type(within(shown).getByLabelText('reviewer'), ' Lovelace');
    await waitFor(() => expect(saves(fake.sent)).toHaveLength(1));
    expect(saves(fake.sent)[0]!.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000001',
      parameters: { ...MADE_WITH, reviewer: 'Ada Lovelace' },
    });
    expect(await screen.findByText('Version 0.2 in General')).toBeInTheDocument();
  });

  it('opens the next outline act from the version the parameter save answered', async () => {
    const fake = withParameters();
    open(fake.fetch);
    const shown = await panel();
    await userEvent.type(within(shown).getByLabelText('reviewer'), 'x');
    await screen.findByText('Version 0.2 in General');

    await userEvent.click(item('Introduction'));
    await userEvent.click(screen.getByRole('button', { name: 'Add section' }));
    await userEvent.type(screen.getByLabelText('New section title'), 'Method{Enter}');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    expect(fake.edits()[0]!.body).toMatchObject({
      openedFrom: 'dddddddd-0000-4000-8000-000000000002',
    });
    await screen.findByText('Version 0.3 in General');
  });

  it("shows the service's refusal of a change beside the parameter it names", async () => {
    const fake = withParameters();
    open(fake.fetch);
    const shown = await panel();
    fake.refuse(PARAMETERS, 400, {
      code: 'parameter_invalid',
      message: 'A value does not fit its parameter.',
      traceId: 't',
      problems: [{ parameter: 'reviewer', rule: 'maxLength', value: 'Ada x', field: 'f1' }],
    });
    await userEvent.type(within(shown).getByLabelText('reviewer'), ' x');
    await waitFor(() =>
      expect(within(shown).getByLabelText('reviewer')).toHaveAccessibleDescription(
        'reviewer is longer than the field it fills allows: Ada x.',
      ),
    );
    expect(within(shown).getByLabelText('reviewer')).toHaveAttribute('aria-invalid', 'true');
  });

  it('offers no change in Reading, and none to whoever may not edit the document', async () => {
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]), {
      mayEdit: false,
      parameters: { declarations: DECLARED, values: MADE_WITH },
    });
    open(fake.fetch);
    const shown = await panel();
    expect(within(shown).getByLabelText('reviewer')).toHaveAttribute('readonly');
  });

  it('shows the values by name, read only, to a reader the declarations are withheld from', async () => {
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]), {
      parameters: { declarations: [], values: MADE_WITH },
    });
    open(fake.fetch);
    const shown = await panel();
    const terms = within(shown)
      .getAllByRole('term')
      .map((each) => each.textContent);
    const definitions = within(shown)
      .getAllByRole('definition')
      .map((each) => each.textContent);
    expect(terms).toEqual(['due', 'region', 'reviewer']);
    expect(definitions).toEqual(['2026-10-31', 'North', 'Ada']);
    expect(within(shown).queryByRole('textbox')).toBeNull();
    expect(within(shown).getByRole('button', { name: 'History' })).toBeInTheDocument();
  });

  it('shows no panel for a document whose template declares no parameters', async () => {
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]), {
      parameters: { declarations: [], values: {} },
    });
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await waitFor(() => expect(fake.sent.some((each) => each.url === PARAMETERS)).toBe(true));
    expect(screen.queryByRole('region', { name: 'Parameters' })).toBeNull();
  });
});
