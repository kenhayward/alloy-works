import type { OutlineViewNode } from '@alloy-works/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmRemoval, PartPanel, PartReadOnly, type PartFacts } from './PartPanel.js';

const text = (value: string) => [{ type: 'text', value, marks: [] }];

const section = (id: string, title: string, over: Partial<OutlineViewNode> = {}) =>
  ({
    id,
    type: 'section',
    title: text(title),
    numbered: true,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children: [],
    ...over,
  }) as unknown as OutlineViewNode;

const placed = (id: string, component: string | null, kind = 'latest') =>
  ({
    id,
    type: 'reference',
    component,
    numbered: true,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children: [],
    mode: { kind },
  }) as unknown as OutlineViewNode;

const NAMES = new Map([['c1', 'Install the printer']]) as never;

const factsOf = (node: OutlineViewNode, over: Partial<PartFacts> = {}): PartFacts => ({
  node,
  names: NAMES,
  parent: null,
  matter: 'body',
  number: undefined,
  wouldBe: undefined,
  state: undefined,
  address: 'http://here/#/documents/d/nodes/n',
  references: [],
  referencedBy: <p>What refers to it</p>,
  placed: [],
  usedIn: undefined,
  fieldCount: 0,
  ...over,
});

function Panel({
  facts,
  onOperation = async () => [] as never,
  unnumberedAbove,
  conditionsSaid = null,
  onRemove = () => undefined,
  onNotice = () => undefined,
}: {
  facts: PartFacts;
  onOperation?: (operation: unknown) => Promise<never>;
  unnumberedAbove?: OutlineViewNode;
  conditionsSaid?: string | null;
  onRemove?: () => void;
  onNotice?: (message: string | null) => void;
}) {
  const openField = useRef(new Map<string, number>());
  return (
    <PartPanel
      facts={facts}
      busy={false}
      topLevel={facts.parent === null}
      frontOffered
      frontAfter={undefined}
      unnumberedAbove={unnumberedAbove}
      onOperation={onOperation as never}
      onRetitle={async () => 'unsent' as never}
      openField={openField}
      onNotice={onNotice}
      onRemove={onRemove}
      onGoTo={() => undefined}
      onConditions={() => undefined}
      language="en-GB"
      direction="ltr"
      onEquation={() => undefined}
      onWithdrawEquation={() => undefined}
      sectionFields={[]}
      schemas={[]}
      people={[]}
      conditionsSaid={conditionsSaid}
    />
  );
}

beforeEach(() => {
  window.localStorage.removeItem('aw.part.groups');
});

describe('Overrides in the head (part-panel-2, decision 3)', () => {
  const icon = (name: RegExp | string) => screen.getByRole('button', { name });
  const badge = () => document.querySelector('[class*="badge"]');

  it('REU-011 opens the dialog, plain and with no badge where none stands here', async () => {
    const opened: string[] = [];
    render(
      <Panel
        facts={factsOf(placed('r', 'c1'), {
          overrides: { count: 0, stale: 0, onOpen: () => opened.push('r') },
        })}
      />,
    );
    const button = icon('Overrides');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAccessibleDescription(/in this document only/);
    expect(badge()).toBeNull();
    await userEvent.click(button);
    expect(opened).toEqual(['r']);
  });

  it('REU-011 counts the paragraphs reworded here, on its badge and in its name', () => {
    render(
      <Panel
        facts={factsOf(placed('r', 'c1'), {
          overrides: { count: 2, stale: 0, onOpen: () => undefined },
        })}
      />,
    );
    icon('Overrides, 2 paragraphs reworded here');
    expect(badge()).toHaveTextContent('2');
    expect(badge()?.parentElement?.closest('[data-stale]')).toBeNull();
  });

  it('REU-015 says where one no longer applies, on its badge, in its name and in its tip', async () => {
    render(
      <Panel
        facts={factsOf(placed('r', 'c1'), {
          overrides: { count: 2, stale: 1, onOpen: () => undefined },
        })}
      />,
    );
    const button = icon('Overrides, 2 paragraphs reworded here, 1 no longer applies');
    expect(badge()?.closest('[data-stale]')).not.toBeNull();
    await userEvent.hover(button);
    expect(document.querySelector('[data-name-tip]')).toHaveTextContent(
      'Overrides · 2 paragraphs reworded here, 1 no longer applies',
    );
  });

  it('is not there where it is not offered, nor on a section', () => {
    render(<Panel facts={factsOf(section('s', 'Methods'))} />);
    expect(screen.queryByRole('button', { name: /^Overrides/ })).toBeNull();
  });

  it('every icon tips at once, in place of the browser tip, keeping its name', async () => {
    render(<Panel facts={factsOf(section('s', 'Methods'))} />);
    const remove = icon('Remove section Methods');
    expect(remove).not.toHaveAttribute('title');
    await userEvent.hover(remove);
    expect(document.querySelector('[data-name-tip]')).toHaveTextContent(/^Remove section$/);
    expect(icon('Go to it in the text')).not.toHaveAttribute('title');
  });
});

describe('the Part panel, grouped and folding', () => {
  it('says what a part is and where it sits, its chips, its acts as icons', () => {
    render(
      <Panel
        facts={factsOf(placed('r', 'c1', 'pinned'), {
          parent: section('s', 'Performance'),
          number: '6.1',
          state: { key: 'approved', name: 'Approved' },
        })}
      />,
    );
    expect(screen.getByText('Component · In Performance')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install the printer' })).toHaveAttribute(
      'href',
      '#/components/c1',
    );
    expect(screen.getByText('Number 6.1')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    for (const name of [
      'Go to it in the text',
      'Copy a link to Install the printer',
      'Remove component Install the printer',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('opens Layout first, says the others in a line, and remembers what is open beyond the part', async () => {
    const { unmount } = render(
      <Panel facts={factsOf(section('s', 'Method'), { number: '2' })} conditionsSaid={null} />,
    );
    expect(screen.getByRole('button', { name: 'Layout' })).toHaveAttribute('aria-expanded', 'true');
    const readers = screen.getByRole('button', { name: /^Readers/ });
    expect(readers).toHaveAttribute('aria-expanded', 'false');
    expect(readers).toHaveTextContent('Every reader');
    expect(screen.getByRole('button', { name: /^Links/ })).toHaveTextContent('Nothing refers');
    expect(screen.queryByText('What refers to it')).not.toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: /^Layout/ }));
    expect(screen.getByRole('button', { name: /^Layout/ })).toHaveTextContent(
      'Wherever it falls · numbered 2 · Body',
    );
    await userEvent.click(readers);
    expect(readers).not.toHaveTextContent('Every reader');
    expect(screen.getByRole('button', { name: 'Set condition on Method' })).toBeVisible();
    unmount();

    render(<Panel facts={factsOf(section('t', 'Results'))} />);
    expect(screen.getByRole('button', { name: /^Layout/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: /^Readers/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('chooses where a part starts from three icons, each named in full', async () => {
    const onOperation = vi.fn(async () => [] as never);
    render(<Panel facts={factsOf(section('s', 'Method'))} onOperation={onOperation} />);
    const group = screen.getByRole('radiogroup', { name: 'Starts on' });
    expect(within(group).getByRole('radio', { name: 'Wherever it falls' })).toHaveTextContent(
      'Flows on',
    );
    await userEvent.click(within(group).getByRole('radio', { name: 'A new right-hand page' }));
    expect(onOperation).toHaveBeenCalledWith({ operation: 'set', node: 's', pageBreak: 'recto' });
  });

  it('says what number a part has or takes none', () => {
    const { rerender } = render(<Panel facts={factsOf(section('s', 'Method'), { number: '2' })} />);
    expect(screen.getByRole('switch', { name: 'Numbered' })).toHaveAccessibleDescription(
      'Shown as 2',
    );
    rerender(<Panel facts={factsOf(section('s', 'Method', { numbered: false }))} />);
    expect(screen.getByRole('switch', { name: 'Numbered' })).toHaveAccessibleDescription(
      'Takes no number',
    );
  });

  it('locks Numbered under a part not numbered, saying why and what it would be', async () => {
    const onOperation = vi.fn(async () => [] as never);
    render(
      <Panel
        facts={factsOf(section('s', 'Scope'), { wouldBe: '2.1' })}
        unnumberedAbove={section('p', 'Method', { numbered: false })}
        onOperation={onOperation}
      />,
    );
    const box = screen.getByRole('switch', { name: 'Numbered' });
    expect(box).toHaveAttribute('aria-disabled', 'true');
    expect(box).toHaveAccessibleDescription('Would be 2.1 Not numbered while Method is not.');
    await userEvent.click(box);
    expect(onOperation).not.toHaveBeenCalled();
  });

  it('STR-076 offers to number a title that starts with the number it would take, as one act', async () => {
    const onOperation = vi.fn(async () => [] as never);
    render(
      <Panel
        facts={factsOf(section('s', '6. Performance', { numbered: false }), { wouldBe: '6' })}
        onOperation={onOperation}
      />,
    );
    expect(screen.getByText(/^The title starts with “6\.”/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Number it' }));
    expect(onOperation).toHaveBeenCalledTimes(1);
    expect(onOperation).toHaveBeenCalledWith({
      operation: 'set',
      node: 's',
      numbered: true,
      title: text('Performance'),
    });
  });

  it.each([
    ['the number it would take is another', '6. Performance', '7', false],
    ['the words only look like a number', 'A study of lenses', 'A', false],
    ['it is already numbered', '6. Performance', '6', true],
  ])('STR-076 offers nothing where %s', (_, title, wouldBe, numbered) => {
    render(<Panel facts={factsOf(section('s', title, { numbered }), { wouldBe })} />);
    expect(screen.queryByRole('button', { name: 'Number it' })).toBeNull();
  });

  it('STR-076 offers nothing under a part not numbered, nor to a component', () => {
    const { rerender } = render(
      <Panel
        facts={factsOf(section('s', '6. Performance', { numbered: false }), { wouldBe: '6' })}
        unnumberedAbove={section('p', 'Method', { numbered: false })}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Number it' })).toBeNull();
    rerender(<Panel facts={factsOf(placed('r', 'c1'), { wouldBe: '6' })} />);
    expect(screen.queryByRole('button', { name: 'Number it' })).toBeNull();
  });

  it('says of a component the reader may not read what they still may do, and keeps its other groups', () => {
    render(<Panel facts={factsOf(placed('r', null))} />);
    expect(screen.getByText('Not yours to read')).toBeInTheDocument();
    expect(screen.getByText(/^You may not read this component\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'A component' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Readers/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Links/ })).toBeInTheDocument();
  });

  it('shows the address to copy by hand where the clipboard will not take it', async () => {
    const onNotice = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('refused')) },
    });
    render(<Panel facts={factsOf(section('s', 'Method'))} onNotice={onNotice} />);
    expect(screen.queryByRole('textbox', { name: 'Link to Method' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Copy a link to Method' }));
    expect(await screen.findByRole('textbox', { name: 'Link to Method' })).toHaveValue(
      'http://here/#/documents/d/nodes/n',
    );
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/could not be/));
  });
});

describe('the Part panel for a reader who may not change the document', () => {
  it('offers no Remove and no Layout, and still says what refers to it', () => {
    window.localStorage.setItem('aw.part.groups', 'links');
    render(
      <PartReadOnly
        facts={factsOf(section('s', 'Method'))}
        onGoTo={() => undefined}
        onNotice={() => undefined}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Layout/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy a link to Method' })).toBeInTheDocument();
    expect(screen.getByText('What refers to it')).toBeVisible();
  });

  it('names the panel where nothing is chosen, and offers no act', () => {
    render(<PartReadOnly facts={undefined} onGoTo={() => undefined} onNotice={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Part' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('removing a part', () => {
  const removal = (node: OutlineViewNode, needsReason = false) => {
    const onRemove = vi.fn();
    const onKeep = vi.fn();
    render(
      <ConfirmRemoval
        node={node}
        names={NAMES}
        referencedBy={null}
        needsReason={needsReason}
        onRemove={onRemove}
        onKeep={onKeep}
      />,
    );
    return { onRemove, onKeep };
  };

  it('is a dialog named by its question, the focus on keeping, Escape keeping', async () => {
    const { onKeep } = removal(placed('r', 'c1'));
    const dialog = screen.getByRole('dialog', { name: 'Remove Install the printer?' });
    expect(within(dialog).getByRole('button', { name: 'Keep' })).toHaveFocus();
    expect(dialog).toHaveTextContent(
      'The component stays in the library; only its place here goes.',
    );
    expect(dialog).toHaveTextContent('This cannot be undone');
    await userEvent.keyboard('{Escape}');
    expect(onKeep).toHaveBeenCalled();
  });

  it('says what a section places stays in the library', () => {
    removal(section('s', 'Method', { children: [placed('a', 'c1'), placed('b', null)] }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'It places 2 components. They stay in the library; only their place here goes.',
    );
  });

  it('TPL-029 waits for a reason where the template requires one', async () => {
    const { onRemove } = removal(section('s', 'Method'), true);
    const remove = screen.getByRole('button', { name: 'Remove' });
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(remove);
    expect(onRemove).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Why it is removed' }), 'Moved');
    expect(remove).toHaveAttribute('aria-disabled', 'false');
    await userEvent.click(remove);
    expect(onRemove).toHaveBeenCalledWith('Moved');
  });
});
