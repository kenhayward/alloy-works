import { defaultLayout, withholdComponents } from '@alloy-works/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useLayoutEffect, useRef, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import { OutlinePanel } from './OutlinePanel.js';
import {
  outline,
  open,
  section,
  DOCUMENT,
  PRINTER,
  INTRODUCTION,
  SCOPE,
  METHOD,
  RESULTS,
  PREFACE,
  reference,
  service,
  item,
  undoable,
  settled,
  shownTitle,
  typeTitle,
  clearTitle,
} from './test/documentPage.js';

// A section's title is a ProseMirror view since equations 3, which scrolls its selection into view.
shimRangeMeasurement();

describe('the outline panel', () => {
  it('STR-008 moves a node with its whole subtree, as one action undo takes back', async () => {
    // Method, then Introduction with Scope beneath it.
    const fake = service(
      outline([
        section(METHOD, 'Method'),
        section(INTRODUCTION, 'Introduction', [section(SCOPE, 'Scope')]),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    // One act, from the keymap alone: Alt+Right demotes Introduction under the sibling before it.
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');

    // The subtree travelled: Scope is still under Introduction, which is now under Method.
    const method = await screen.findByRole('treeitem', { name: 'Method' });
    await waitFor(() =>
      expect(within(method).getByRole('treeitem', { name: 'Introduction' })).toBeInTheDocument(),
    );
    expect(
      within(item('Introduction')).getByRole('treeitem', { name: 'Scope' }),
    ).toBeInTheDocument();
    // One operation was sent, and it named the node, its new parent and its position - not its
    // subtree: nothing in it mentions Scope.
    expect(fake.edits()).toHaveLength(1);
    expect(fake.edits()[0]?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000001',
      operation: { operation: 'move', node: INTRODUCTION, parent: METHOD, position: 0 },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Moved Introduction under Method.');

    // And it is a single undoable action: one Ctrl+Z, one operation, and the node and its subtree
    // are back at the top level where they were.
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() =>
      expect(within(item('Method')).queryByRole('treeitem', { name: 'Introduction' })).toBeNull(),
    );
    expect(fake.edits()).toHaveLength(2);
    expect(fake.edits()[1]?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000002',
      operation: { operation: 'move', node: INTRODUCTION, parent: null, position: 1 },
    });
    expect(item('Introduction')).toHaveAttribute('aria-level', '1');
    expect(
      within(item('Introduction')).getByRole('treeitem', { name: 'Scope' }),
    ).toBeInTheDocument();
    expect(undoable()).toBe(false);
  });

  it('moves by pointer with the same position convention the service applies', async () => {
    // A drop at the end of the document sends the first of three to position 2, counted after it
    // has left its siblings, and the service's answer lands it last (packages/domain's `move`).
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method'),
        section(RESULTS, 'Results'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    fireEvent.dragStart(item('Introduction'));
    const end = await screen.findByText('Move to the end of the document');
    fireEvent.dragOver(end);
    fireEvent.drop(end);

    await waitFor(() =>
      expect(screen.getByRole('tree')).toHaveTextContent(/Method[\s\S]*Results[\s\S]*Introduction/),
    );
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: { operation: 'move', node: INTRODUCTION, parent: null, position: 2 },
      },
    ]);

    // A drop onto a node makes the dragged node its last child.
    fireEvent.dragStart(item('Introduction'));
    await screen.findByText('Move to the end of the document');
    fireEvent.dragOver(within(screen.getByRole('tree')).getByText('Method'));
    fireEvent.drop(within(screen.getByRole('tree')).getByText('Method'));
    await waitFor(() =>
      expect(
        within(item('Method')).getByRole('treeitem', { name: 'Introduction' }),
      ).toBeInTheDocument(),
    );
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'move', node: INTRODUCTION, parent: METHOD, position: 0 },
    });
  });

  it('walks the nodes with the arrow keys from one tab stop', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [section(SCOPE, 'Scope')]),
        section(METHOD, 'Method'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    const stops = screen.getAllByRole('treeitem').filter((each) => each.tabIndex === 0);
    expect(stops).toEqual([item('Introduction')]);

    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{ArrowDown}');
    expect(item('Scope')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(item('Method')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowLeft}');
    expect(item('Introduction')).toHaveFocus();
    expect(screen.getAllByRole('treeitem').filter((each) => each.tabIndex === 0)).toEqual([
      item('Introduction'),
    ]);
    expect(fake.edits()).toEqual([]);
  });

  it('collapses a section from its triangle, hiding what it holds, and expands it again', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [section(SCOPE, 'Scope')]),
        section(METHOD, 'Method'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    const triangle = (name: string) =>
      item(name).querySelector<HTMLElement>(':scope > [data-row] [data-toggle]');

    // Only a section holding something has a triangle to press.
    expect(triangle('Method')).toBeNull();
    expect(item('Introduction')).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(triangle('Introduction')!);
    expect(item('Introduction')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: 'Scope' })).toBeNull();

    await userEvent.click(triangle('Introduction')!);
    expect(item('Introduction')).toHaveAttribute('aria-expanded', 'true');
    expect(item('Scope')).toBeInTheDocument();
    // Nothing is sent: what is shown is the reader's, not the document's.
    expect(fake.edits()).toEqual([]);
  });

  it('collapses and expands with the arrow keys, and walks past what is collapsed', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [section(SCOPE, 'Scope')]),
        section(METHOD, 'Method'),
      ]),
    );
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('treeitem', { name: 'Introduction' }));

    await userEvent.keyboard('{ArrowLeft}');
    expect(item('Introduction')).toHaveAttribute('aria-expanded', 'false');
    expect(item('Introduction')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(item('Method')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{ArrowRight}');
    expect(item('Introduction')).toHaveAttribute('aria-expanded', 'true');
    expect(item('Introduction')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(item('Scope')).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(item('Introduction')).toHaveFocus();
  });

  it('moves the choice to a section collapsed over it, rather than choosing something hidden', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction', [section(SCOPE, 'Scope')])]),
    );
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('treeitem', { name: 'Scope' }));
    await userEvent.click(
      item('Introduction').querySelector<HTMLElement>(':scope > [data-row] [data-toggle]')!,
    );
    expect(item('Introduction')).toHaveAttribute('aria-selected', 'true');
  });

  it('inserts a section after the selected one, sending one operation and showing what came back', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(RESULTS, 'Results')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    await userEvent.click(item('Introduction'));
    await userEvent.click(screen.getByRole('button', { name: 'Add section' }));
    await userEvent.type(screen.getByLabelText('New section title'), 'Method{Enter}');

    await waitFor(() =>
      expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Method[\s\S]*Results/),
    );
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: {
          operation: 'insert',
          parent: null,
          position: 1,
          node: { type: 'section', title: [{ type: 'text', value: 'Method', marks: [] }] },
        },
      },
    ]);
    expect(screen.getByText('Version 0.2 in General')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Added Method.');
    // The new section is the one selected, with focus, so the keymap carries on from it.
    await waitFor(() => expect(item('Method')).toHaveFocus());
  });

  it('inserts a sibling from the keymap with Enter, and will not send a section with no title', async () => {
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Enter}');
    expect(screen.getByLabelText('New section title')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('A section needs a title.')).toBeInTheDocument();
    expect(fake.edits()).toEqual([]);

    // The hint is about the field as it stands, so it goes the moment the field is fine.
    await userEvent.keyboard('Method');
    expect(screen.queryByText('A section needs a title.')).toBeNull();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('treeitem', { name: 'Method' });
    expect(fake.edits()).toHaveLength(1);
  });

  it('inserts a component reference, with latest, named by the component', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });

    await userEvent.click(screen.getByRole('button', { name: 'Add component' }));
    await userEvent.selectOptions(await screen.findByLabelText('Component'), PRINTER);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(
      await screen.findByRole('treeitem', { name: 'Install the printer, latest' }),
    ).toBeInTheDocument();
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: {
          operation: 'insert',
          parent: null,
          position: 1,
          node: { type: 'reference', component: PRINTER, mode: { kind: 'latest' } },
        },
      },
    ]);
  });

  it('retitles a section as one operation when the field is committed, and undo brings the old title back into the field', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });

    await userEvent.click(item('Method'));
    expect(shownTitle()).toBe('Method');
    await clearTitle();
    // Typed one key at a time under StrictMode, and nothing is sent until the field is committed.
    await typeTitle('Methods and materials ');
    expect(shownTitle()).toBe('Methods and materials ');
    expect(fake.edits()).toEqual([]);
    await userEvent.keyboard('{Enter}');

    await screen.findByRole('treeitem', { name: 'Methods and materials' });
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: {
          operation: 'retitle',
          node: METHOD,
          title: [{ type: 'text', value: 'Methods and materials', marks: [] }],
        },
      },
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByRole('treeitem', { name: 'Method' });
    // The field follows the outline back, rather than keeping the text the undo just took away.
    await userEvent.click(item('Method'));
    expect(shownTitle()).toBe('Method');
    expect(fake.edits()).toHaveLength(2);
  });

  it('puts an emptied title back when the field is left, and sends nothing', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });

    await userEvent.click(item('Method'));
    await clearTitle();
    await userEvent.click(item('Method'));

    expect(shownTitle()).toBe('Method');
    expect(screen.getByRole('status')).toHaveTextContent('A section needs a title.');
    expect(fake.edits()).toEqual([]);
  });

  it('sets where a node starts as one operation, and says what it now does', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(RESULTS, 'Results')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Results' });

    await userEvent.click(item('Results'));
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Results now starts on a new page.'),
    );
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: { operation: 'set', node: RESULTS, pageBreak: 'page' },
      },
    ]);
    expect(screen.getByLabelText('Starts on')).toHaveValue('page');
  });

  it('removes a node and its subtree as one operation, once asked, and says it cannot be undone', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });

    // Introduction moved first, so there is something on the undo stack for the removal to clear.
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await waitFor(() => expect(undoable()).toBe(true));

    await userEvent.click(item('Method'));
    await userEvent.keyboard('{Delete}');
    expect(
      screen.getByText(
        'Remove Method and everything beneath it? This cannot be undone, and nothing before it can be undone afterwards.',
      ),
    ).toBeInTheDocument();
    expect(fake.edits()).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByRole('treeitem', { name: 'Method' })).toBeNull());
    expect(screen.queryByRole('treeitem', { name: 'Scope' })).toBeNull();
    expect(fake.edits().at(-1)?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000002',
      operation: { operation: 'remove', node: METHOD },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Removed Method.');
    expect(undoable()).toBe(false);
  });

  it('keeps the node when the removal is not confirmed', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });

    await userEvent.click(item('Method'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove section' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(item('Method')).toHaveFocus();
    expect(fake.edits()).toEqual([]);
  });

  it('STR-059 surfaces a conflicting act against the outline as it now stands, and clears the undo stack so nothing overwrites it', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    // Ada moves Introduction below Method: one act, on her undo stack.
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() =>
      expect(screen.getByRole('tree')).toHaveTextContent(/Method[\s\S]*Introduction/),
    );
    expect(undoable()).toBe(true);

    // Grace renames Method and moves Introduction back to the top, from another window.
    fake.theirs({
      operation: 'retitle',
      node: METHOD,
      title: [{ type: 'text', value: 'Methods', marks: [] }],
    });
    fake.theirs({ operation: 'move', node: INTRODUCTION, parent: null, position: 0 });

    // Ada, still looking at her own outline, demotes Introduction under Method.
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');

    // Refused against the current outline: the page now shows Grace's outline, not Ada's.
    expect(await screen.findByRole('treeitem', { name: 'Methods' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Somebody else changed this document. This is how it stands now.',
    );
    expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Methods/);
    expect(within(item('Methods')).queryByRole('treeitem')).toBeNull();
    expect(screen.getByText('Version 0.4 in General')).toBeInTheDocument();
    expect(fake.edits()[1]?.body).toMatchObject({
      openedFrom: 'dddddddd-0000-4000-8000-000000000002',
    });

    // And the undo stack is gone: Ada's earlier move cannot be undone onto Grace's outline.
    expect(undoable()).toBe(false);
    item('Introduction').focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(fake.edits()).toHaveLength(2);
    expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Methods/);

    // The next act is made from the outline that came back, and it is recorded.
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(screen.getByText('Version 0.5 in General')).toBeInTheDocument());
    expect(fake.edits()[2]?.body).toMatchObject({
      openedFrom: 'dddddddd-0000-4000-8000-000000000004',
    });
  });

  it('says a caller may not change the document on a 403, and leaves the outline as it was', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    fake.refuse(`/v1/documents/${DOCUMENT}/outline`, 403);
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('You may not change this document.'),
    );
    expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Method/);
    expect(screen.getByText('Version 0.1 in General')).toBeInTheDocument();
    // Nothing is offered that could only be refused again.
    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
  });

  it('says the caller is signed out on a 401, distinctly from a refusal or a failure', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    fake.refuse(`/v1/documents/${DOCUMENT}/outline`, 401);
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'You are signed out. Sign in again to change this document.',
      ),
    );
    expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Method/);
  });

  it('shows nothing as a refusal, and adds nothing to undo, when an act changes nothing', async () => {
    // Decision K: the service answers 200 at the same version when an act puts things back where
    // they were. That is not a refusal and must not read as one, and there is nothing to undo.
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    fake.unchanged();
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await settled();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Method/);
    expect(screen.getByText('Version 0.1 in General')).toBeInTheDocument();
    expect(undoable()).toBe(false);
  });

  it('renders a reference whose mode is approved as waiting on revisions rather than a version', async () => {
    const fake = service(outline([reference(RESULTS, 'approved'), reference(SCOPE, 'latest')]));
    open(fake.fetch);

    expect(
      await screen.findByRole('treeitem', { name: 'Install the printer, waiting on revisions' }),
    ).toBeInTheDocument();
    expect(item('Install the printer, latest')).toBeInTheDocument();
    expect(screen.getByRole('tree')).not.toHaveTextContent(/version/i);
  });

  it('says a document with no nodes has no sections yet, and still takes an insert', async () => {
    const fake = service(outline([]));
    open(fake.fetch);

    expect(await screen.findByText('This document has no sections yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add section' }));
    await userEvent.type(screen.getByLabelText('New section title'), 'Introduction{Enter}');

    expect(await screen.findByRole('treeitem', { name: 'Introduction' })).toBeInTheDocument();
    expect(screen.queryByText('This document has no sections yet.')).toBeNull();
    expect(fake.edits()[0]?.body).toMatchObject({
      operation: { operation: 'insert', parent: null, position: 0 },
    });
  });

  it('offers a reader the outline to read and nothing to change', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
      {
        mayEdit: false,
      },
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    expect(screen.getByText('You may read this document but not change it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
    expect(screen.queryByLabelText('Title')).toBeNull();
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}{Delete}{Enter}');
    expect(fake.edits()).toEqual([]);
  });

  it('sends one operation, not two, when a second key lands before the first answers', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method'),
        section(RESULTS, 'Results'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    const release = fake.hold();
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    release();

    await waitFor(() => expect(screen.getByText('Version 0.2 in General')).toBeInTheDocument());
    expect(fake.edits()).toHaveLength(1);
  });

  it('offers Manage access on a document only to someone who may administer it', async () => {
    const administering = service(outline([section(METHOD, 'Method')]), { administers: true });
    const { unmount } = open(administering.fetch);
    expect(await screen.findByRole('link', { name: 'Manage access' })).toHaveAttribute(
      'href',
      `#/documents/${DOCUMENT}/access`,
    );
    expect(
      administering.sent.find((each) => each.url === '/v1/access'),
      'asked about the document',
    ).toBeDefined();
    unmount();

    const reading = service(outline([section(METHOD, 'Method')]), { administers: false });
    open(reading.fetch);
    await screen.findByRole('treeitem', { name: /Method/ });
    await waitFor(() => expect(reading.sent.some((each) => each.url === '/v1/access')).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('link', { name: 'Manage access' })).toBeNull();
  });

  it('says a document is not there, or not readable, on a 404', async () => {
    const fake = service(outline([]));
    fake.refuse(`/v1/documents/${DOCUMENT}`, 404);
    open(fake.fetch);
    expect(
      await screen.findByText('There is nothing here, or nothing you may read.'),
    ).toBeInTheDocument();
  });

  it('says a document could not be opened, and opens it on Try again', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    fake.refuse(`/v1/documents/${DOCUMENT}`, 500);
    open(fake.fetch);
    expect(await screen.findByText('The document could not be opened.')).toBeInTheDocument();

    fake.restore(`/v1/documents/${DOCUMENT}`);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('treeitem', { name: 'Method' })).toBeInTheDocument();
  });
});

/** The Part tab's Matter, a three-way switch (ADR-0054): its radio group, its choices, the one chosen. */
const matter = () => screen.getByRole('radiogroup', { name: 'Matter' });
const matterOptions = () =>
  within(matter())
    .getAllByRole('radio')
    .map((each) => each.getAttribute('aria-label'));
const chosenMatter = () =>
  within(matter()).getByRole('radio', { checked: true }).getAttribute('aria-label');
const chooseMatter = (name: string) =>
  userEvent.click(within(matter()).getByRole('radio', { name }));

describe('section numbers in the outline panel', () => {
  it('STR-065 shows each numbered node its section number, and renumbers a move without asking for one', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    // The number describes the item, and the title stays its name.
    expect(item('Introduction')).toHaveAccessibleDescription('1');
    expect(item('Method')).toHaveAccessibleDescription('2');
    expect(item('Scope')).toHaveAccessibleDescription('2.1');

    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(item('Introduction')).toHaveAccessibleDescription('2'));
    expect(item('Method')).toHaveAccessibleDescription('1');
    expect(item('Scope')).toHaveAccessibleDescription('1.1');
    // Numbered from the outline the page holds: nothing asked the service for a number.
    expect(fake.sent.some((request) => request.url.endsWith('/numbering'))).toBe(false);
  });

  it('takes a node out of the numbering, and its subtree with it, from its Numbered box', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
        section(RESULTS, 'Results'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    await userEvent.click(item('Method'));
    await userEvent.click(screen.getByRole('switch', { name: 'Numbered' }));
    await waitFor(() => expect(item('Method')).not.toHaveAccessibleDescription());
    expect(fake.edits().at(-1)?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000001',
      operation: { operation: 'set', node: METHOD, numbered: false },
    });
    expect(item('Scope')).not.toHaveAccessibleDescription();
    // Results takes the number Method no longer consumes.
    expect(item('Results')).toHaveAccessibleDescription('2');
    expect(screen.getByRole('status')).toHaveTextContent('Method is no longer numbered.');
    expect(screen.getByRole('switch', { name: 'Numbered' })).not.toBeChecked();

    // And back again, from the same box.
    await userEvent.click(screen.getByRole('switch', { name: 'Numbered' }));
    await waitFor(() => expect(item('Method')).toHaveAccessibleDescription('2'));
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'set', node: METHOD, numbered: true },
    });
    expect(item('Scope')).toHaveAccessibleDescription('2.1');
    expect(item('Results')).toHaveAccessibleDescription('3');
    expect(screen.getByRole('status')).toHaveTextContent('Method is now numbered.');
    expect(screen.getByRole('switch', { name: 'Numbered' })).toBeChecked();
  });

  it('makes a top-level node an appendix, numbered in its own scheme, and offers it nowhere else', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    await userEvent.click(item('Scope'));
    expect(screen.getByRole('switch', { name: 'Numbered' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Matter' })).toBeNull();
    await userEvent.click(item('Method'));
    await chooseMatter('Appendix');
    await waitFor(() => expect(item('Method')).toHaveAccessibleDescription('A'));
    expect(item('Scope')).toHaveAccessibleDescription('A.1');
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'set', node: METHOD, matter: 'appendix' },
    });
    // Only the one switch: `values` is never sent from here.
    expect(fake.edits().at(-1)?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000001',
      operation: { operation: 'set', node: METHOD, matter: 'appendix' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Method is now an appendix.');
    expect(chosenMatter()).toBe('Appendix');

    await chooseMatter('Body');
    await waitFor(() => expect(item('Method')).toHaveAccessibleDescription('2'));
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'set', node: METHOD, matter: 'body' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Method is now in the body.');
  });

  it('offers Front matter, Body and Appendix for a top-level node, and Front matter only before the body begins', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
        section(RESULTS, 'Results'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    // Below the top level a node's matter is its top-level ancestor's, so there is nothing to set.
    await userEvent.click(item('Scope'));
    expect(screen.queryByRole('radiogroup', { name: 'Matter' })).toBeNull();

    await userEvent.click(item('Introduction'));
    expect(matterOptions()).toEqual(['Front matter', 'Body', 'Appendix']);
    expect(chosenMatter()).toBe('Body');

    await chooseMatter('Front matter');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Introduction is now front matter.'),
    );
    expect(fake.edits().at(-1)?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000001',
      operation: { operation: 'set', node: INTRODUCTION, matter: 'front' },
    });
    expect(chosenMatter()).toBe('Front matter');
    // Front matter numbers on counters of its own, so the body's first chapter is still 1.
    expect(item('Introduction')).toHaveAccessibleDescription('i');
    expect(item('Method')).toHaveAccessibleDescription('1');

    // Method is the first node that is not front matter, so nothing but front matter precedes it
    // and it may still become some.
    await userEvent.click(item('Method'));
    expect(matterOptions()).toEqual(['Front matter', 'Body', 'Appendix']);

    // Results has the body before it, so it is not offered as front matter at all.
    await userEvent.click(item('Results'));
    expect(matterOptions()).toEqual(['Body', 'Appendix']);
  });

  it('will not let a front node leave front matter while another front node follows it, and says why', async () => {
    const fake = service(
      outline([
        { ...section(PREFACE, 'Preface'), matter: 'front' },
        { ...section(INTRODUCTION, 'Introduction'), matter: 'front' },
        section(METHOD, 'Method'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });

    // Making the Preface body matter would leave the Introduction, still front matter, after it,
    // which the outline's parse refuses. The select is disabled and says why beside itself, the
    // shape the Numbered box's hint follows, rather than offering a choice that would be refused.
    await userEvent.click(item('Preface'));
    const stuck = matter();
    expect(stuck).toHaveAttribute('aria-disabled', 'true');
    expect(stuck).toHaveAccessibleDescription(
      'Front matter comes first, so this cannot leave while Introduction is front matter.',
    );

    // The Introduction is the last front node, so it may still be given any of the three.
    await userEvent.click(item('Introduction'));
    expect(matter()).not.toHaveAttribute('aria-disabled');
    expect(matter()).toHaveAccessibleDescription('');
    expect(matterOptions()).toEqual(['Front matter', 'Body', 'Appendix']);
    await chooseMatter('Body');
    await waitFor(() => expect(item('Introduction')).toHaveAccessibleDescription('1'));

    // And now nothing follows the Preface in front matter, so it is free too.
    await userEvent.click(item('Preface'));
    expect(matter()).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText(/Front matter comes first/)).toBeNull();
  });

  it('says front matter stays at the top level and comes first, and sends nothing', async () => {
    const fake = service(
      outline([
        { ...section(PREFACE, 'Preface'), matter: 'front' },
        { ...section(INTRODUCTION, 'Introduction'), matter: 'front' },
        section(METHOD, 'Method'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Introduction'));

    // Alt+Right would nest it under the Preface, where the outline's parse refuses front matter.
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Front matter and appendices stay at the top level.',
      ),
    );
    expect(item('Introduction')).toHaveAttribute('aria-level', '1');

    // And Alt+Down would take it past the body, where front matter may not go.
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Front matter comes before the rest of the outline.',
      ),
    );
    expect(fake.edits()).toEqual([]);
    expect(item('Introduction')).toHaveAccessibleDescription('ii');
  });

  it('takes a Matter change back with Ctrl+Z, from the switch it was made in', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Introduction'));
    await chooseMatter('Front matter');
    await waitFor(() => expect(item('Introduction')).toHaveAccessibleDescription('i'));
    await settled();

    // A select has no undo of its own, so Ctrl+Z from it is the panel's, and one operation takes
    // the act back - the same shape the Numbered box and the Starts on select follow.
    within(matter()).getByRole('radio', { checked: true }).focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Undone. Introduction is now in the body.',
      ),
    );
    expect(fake.edits()).toHaveLength(2);
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'set', node: INTRODUCTION, matter: 'body' },
    });
    expect(chosenMatter()).toBe('Body');
    expect(item('Introduction')).toHaveAccessibleDescription('1');
  });

  it('numbers a reference to a component the reader may not read like any other node', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction', [reference(RESULTS, 'latest')])]),
      { mayRead: () => false },
    );
    open(fake.fetch);
    const withheld = await screen.findByRole('treeitem', { name: /A component/ });
    expect(withheld).toHaveAccessibleDescription('1.1');
  });
});

describe('an appendix in the outline panel', () => {
  /** Method with Scope beneath it, then Results as an appendix. */
  const withAnAppendix = () =>
    outline([
      section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
      { ...section(RESULTS, 'Results'), matter: 'appendix' },
    ]);

  it('sends nothing when Alt+Right would put an appendix below the top level, and says why', async () => {
    const fake = service(withAnAppendix());
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    expect(item('Results')).toHaveAccessibleDescription('A');
    await userEvent.click(item('Results'));
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Front matter and appendices stay at the top level.',
      ),
    );
    expect(fake.edits()).toEqual([]);
    expect(item('Results')).toHaveAttribute('aria-level', '1');
  });

  it('offers no drop into a node for an appendix, and sends nothing on one', async () => {
    const fake = service(withAnAppendix());
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    fireEvent.dragStart(item('Results'));
    await screen.findByText('Move to the end of the document');
    // Not taken: a drop place the browser is not told it may drop on.
    expect(fireEvent.dragOver(within(screen.getByRole('tree')).getByText('Method'))).toBe(true);
    fireEvent.drop(within(screen.getByRole('tree')).getByText('Method'));
    fireEvent.dragEnd(item('Results'));
    await waitFor(() => expect(screen.queryByText('Move to the end of the document')).toBeNull());
    expect(fake.edits()).toEqual([]);
    expect(item('Results')).toHaveAttribute('aria-level', '1');
  });

  it('offers no drop before a nested node for an appendix, and sends nothing on one', async () => {
    const fake = service(withAnAppendix());
    const { container } = open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    fireEvent.dragStart(item('Results'));
    await screen.findByText('Move to the end of the document');
    const beforeScope = container.querySelector(`[data-drop="before:${SCOPE}"]`);
    expect(beforeScope).not.toBeNull();
    expect(fireEvent.dragOver(beforeScope!)).toBe(true);
    fireEvent.drop(beforeScope!);
    fireEvent.dragEnd(item('Results'));
    await waitFor(() => expect(screen.queryByText('Move to the end of the document')).toBeNull());
    expect(fake.edits()).toEqual([]);
    expect(item('Results')).toHaveAttribute('aria-level', '1');
  });

  it('says why a node whose own box is ticked has no number', async () => {
    const fake = service(
      outline([
        { ...section(METHOD, 'Method', [section(SCOPE, 'Scope')]), numbered: false },
        section(RESULTS, 'Results'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    await userEvent.click(item('Scope'));
    const box = screen.getByRole('switch', { name: 'Numbered' });
    expect(box).toBeChecked();
    expect(box).toHaveAccessibleDescription('Not numbered while Method is not.');
    expect(screen.getByText('Not numbered while Method is not.')).toBeInTheDocument();

    // Nothing to say beside a node that is itself unticked, or one with a number.
    await userEvent.click(item('Method'));
    expect(screen.getByRole('switch', { name: 'Numbered' })).not.toHaveAccessibleDescription();
    await userEvent.click(item('Results'));
    expect(screen.getByRole('switch', { name: 'Numbered' })).not.toHaveAccessibleDescription();
    expect(screen.queryByText(/Not numbered while/)).toBeNull();
  });
});

describe('a drag started before the panel has settled', () => {
  /**
   * Starts a drag on the first tree item from a layout effect: after the panel's DOM is in the page,
   * and before its passive effects have run - which under `<StrictMode>` include the simulated
   * unmount React runs once on mount. Under load the scheduler defers those effects past a real
   * `dragstart` the same way (issue #131); this puts the drag there every time rather than by luck.
   * Once only, so StrictMode's replayed layout effect does not start a second drag that would hide it.
   */
  function DragOnMount({ children }: { children: ReactNode }) {
    const box = useRef<HTMLDivElement>(null);
    const started = useRef(false);
    useLayoutEffect(() => {
      if (started.current) return;
      started.current = true;
      box.current
        ?.querySelector('[role="treeitem"]')
        ?.dispatchEvent(new Event('dragstart', { bubbles: true }));
    }, []);
    return <div ref={box}>{children}</div>;
  }

  it('records a drag that starts before the panel mounts its effects', async () => {
    render(
      <StrictMode>
        <DragOnMount>
          <OutlinePanel
            outline={withholdComponents(
              outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
              () => true,
            )}
            editable
            scheme={defaultLayout.scheme}
            onOperation={vi.fn()}
            notice={null}
          />
        </DragOnMount>
      </StrictMode>,
    );
    expect(await screen.findByText('Move to the end of the document')).toBeInTheDocument();
  });
});

describe('undo from the node details', () => {
  it('undoes from a checkbox or a select, which have no undo of their own, and leaves a title field its own', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));
    const box = screen.getByRole('switch', { name: 'Numbered' });
    await userEvent.click(box);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Method is no longer numbered.'),
    );
    await settled();
    expect(fake.edits()).toHaveLength(1);

    // A title field keeps Ctrl+Z for what is being typed in it: nothing is sent.
    screen.getByRole('textbox', { name: 'Title' }).focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(fake.edits()).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Method is no longer numbered.');

    // The box has no undo of its own, so the panel's takes the act back, with the focus still on it.
    screen.getByRole('switch', { name: 'Numbered' }).focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Undone. Method is now numbered.'),
    );
    expect(fake.edits()).toHaveLength(2);
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'set', node: METHOD, numbered: true },
    });
    expect(screen.getByRole('switch', { name: 'Numbered' })).toBeChecked();
    expect(item('Method')).toHaveAccessibleDescription('2');
    await settled();

    // And the same from the select beside it.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Starts on' }), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(3));
    await settled();
    screen.getByRole('combobox', { name: 'Starts on' }).focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(fake.edits()).toHaveLength(4));
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'set', node: METHOD, pageBreak: 'none' },
    });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Undone\./));
  });
});

describe("the Part tab's rows (ADR-0054)", () => {
  it('sets a part out in labelled rows: the Equation inside the title, Copy inside the link, Remove last, and a component linked by its name', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction', [reference(SCOPE, 'latest')])]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await userEvent.click(item('Introduction'));
    const part = () => document.querySelector<HTMLElement>('[data-part="details"]')!;

    const title = within(part()).getByRole('textbox', { name: 'Title' });
    const equation = within(part()).getByRole('button', { name: 'Equation' });
    expect(equation).toHaveAttribute('title', 'Equation (Ctrl or Cmd, Shift and E)');
    expect(equation.closest('[data-field]')).toBe(title.closest('[data-field]'));
    const link = within(part()).getByRole('textbox', { name: 'Link to Introduction' });
    const copy = within(part()).getByRole('button', { name: 'Copy link' });
    expect(copy.closest('[data-field]')).toBe(link.closest('[data-field]'));
    const remove = within(part()).getByRole('button', { name: 'Remove section' });
    expect(link.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // A component has no title of its own: its name links to it.
    await userEvent.click(item('Install the printer, latest'));
    expect(within(part()).getByRole('link', { name: 'Install the printer' })).toHaveAttribute(
      'href',
      `#/components/${PRINTER}`,
    );
    expect(within(part()).getByRole('button', { name: 'Remove component' })).toBeInTheDocument();
  });
});
