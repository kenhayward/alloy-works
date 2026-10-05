import { OUTLINE_SCHEMA_VERSION, type OutlineNode } from '@alloy-works/domain';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import {
  outline,
  open,
  section,
  SPACE,
  PRINTER,
  INTRODUCTION,
  METHOD,
  RESULTS,
  reference,
  service,
  item,
  undoable,
  settled,
  shownTitle,
  typeTitle,
  clearTitle,
  OUTLINE_URL,
  SOMEBODY_ELSE,
} from './test/documentPage.js';

// A section's title is a ProseMirror view since equations 3, which scrolls its selection into view.
shimRangeMeasurement();

describe('the outline panel, answered', () => {
  it('gives a refused retitle back to the outline, so leaving the field does not send it again', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    // Grace changes something unrelated - Introduction's page break - so Method's title stays as it was.
    fake.theirs({ operation: 'set', node: INTRODUCTION, pageBreak: 'page' });
    await clearTitle();
    await typeTitle('Methods{Enter}');

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(SOMEBODY_ELSE));
    expect(item('Method')).toBeInTheDocument();
    // The field gives way to the outline it was refused against, rather than holding the refused text.
    expect(shownTitle()).toBe('Method');

    // Leaving the field sends nothing: the act she was told was refused does not go through.
    await userEvent.click(screen.getByRole('button', { name: 'Add section' }));
    expect(fake.edits()).toHaveLength(1);
    expect(screen.queryByRole('treeitem', { name: 'Methods' })).toBeNull();
  });

  it('keeps every key typed while an act is in flight, and every control focusable', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    expect(screen.getByRole('tree')).toHaveAttribute('aria-busy', 'true');
    // Nothing that may hold focus is disabled under the author while the answer is awaited.
    expect(screen.getByLabelText('Starts on')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled();
    await typeTitle('s');
    expect(shownTitle()).toBe('Methods');

    release();
    await settled();
    expect(screen.getByRole('status')).toHaveTextContent('Method now starts on a new page.');
    expect(shownTitle()).toBe('Methods');
    expect(fake.edits()).toHaveLength(1);
  });

  it('keeps a retitle that was not saved, so the next Enter is the retry the page asks for', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    fake.refuse(OUTLINE_URL, 500);
    await typeTitle(' and materials{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'The change was not saved. Try it again.',
      ),
    );
    // Nothing else is shown in its place, so the text is still there to try again with.
    expect(shownTitle()).toBe('Method and materials');

    fake.restore(OUTLINE_URL);
    await settled();
    await typeTitle('{Enter}');
    expect(
      await screen.findByRole('treeitem', { name: 'Method and materials' }),
    ).toBeInTheDocument();
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: {
          operation: 'retitle',
          node: METHOD,
          title: [{ type: 'text', value: 'Method and materials', marks: [] }],
        },
      },
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: {
          operation: 'retitle',
          node: METHOD,
          title: [{ type: 'text', value: 'Method and materials', marks: [] }],
        },
      },
    ]);
  });

  it('sends a retitle committed with Enter while another act is in flight, once that act is answered', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await typeTitle('s{Enter}');
    expect(fake.edits()).toHaveLength(1);

    release();
    expect(await screen.findByRole('treeitem', { name: /^Methods/ })).toBeInTheDocument();
    // Sent from the version the first act made, so it is not refused as a conflict with itself.
    expect(fake.edits()[1]?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000002',
      operation: {
        operation: 'retitle',
        node: METHOD,
        title: [{ type: 'text', value: 'Methods', marks: [] }],
      },
    });
    expect(shownTitle()).toBe('Methods');
  });

  it('sends a retitle left behind while another act is in flight, even once its field has gone', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await typeTitle('s');
    // Leaving for another node blurs the field, and the field goes with the selection.
    await userEvent.click(item('Introduction'));
    expect(shownTitle()).toBe('Introduction');
    expect(fake.edits()).toHaveLength(1);

    release();
    expect(await screen.findByRole('treeitem', { name: /^Methods/ })).toBeInTheDocument();
    expect(fake.edits()).toHaveLength(2);
    expect(screen.getByText('Version 0.3 in General')).toBeInTheDocument();
  });

  it('drops a held retitle when the act in flight is refused because Grace renamed the same section', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await typeTitle('s{Enter}');
    fake.theirs({
      operation: 'retitle',
      node: METHOD,
      title: [{ type: 'text', value: 'Approach', marks: [] }],
    });
    release();

    expect(await screen.findByRole('treeitem', { name: 'Approach' })).toBeInTheDocument();
    await settled();
    // Time for a held retitle to have gone, had it been going to.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fake.edits()).toHaveLength(1);
    expect(item('Approach')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(SOMEBODY_ELSE);
    expect(shownTitle()).toBe('Approach');
  });

  it('drops a held retitle when the act in flight is refused because Grace changed another section', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await typeTitle('s{Enter}');
    fake.theirs({ operation: 'set', node: INTRODUCTION, pageBreak: 'page' });
    release();

    expect(
      await screen.findByRole('treeitem', { name: 'Introduction, starts on a new page' }),
    ).toBeInTheDocument();
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fake.edits()).toHaveLength(1);
    expect(item('Method')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(SOMEBODY_ELSE);
    expect(shownTitle()).toBe('Method');
  });

  it('sends a held retitle anyway when the act in flight was not saved, since nothing it could overwrite was shown', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    fake.refuseNext(OUTLINE_URL, 500);
    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await typeTitle('s{Enter}');
    release();

    expect(await screen.findByRole('treeitem', { name: 'Methods' })).toBeInTheDocument();
    expect(fake.edits()).toHaveLength(2);
    expect(fake.edits()[1]?.body).toMatchObject({
      openedFrom: 'dddddddd-0000-4000-8000-000000000001',
      operation: { operation: 'retitle', node: METHOD },
    });
    expect(shownTitle()).toBe('Methods');
  });

  it('sends a held retitle whose field has closed when the act in flight was not saved', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    fake.refuseNext(OUTLINE_URL, 500);
    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await typeTitle('s');
    await userEvent.click(item('Introduction'));
    release();

    expect(await screen.findByRole('treeitem', { name: 'Methods' })).toBeInTheDocument();
    expect(fake.edits()).toHaveLength(2);
  });

  it('names a retitle that was not saved once its field has closed, rather than losing it silently', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    fake.refuse(OUTLINE_URL, 500);
    await typeTitle('s');
    // Leaving for another node commits it, and closes its field.
    await userEvent.click(item('Introduction'));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'The title Methods was not saved. Select the section and try it again.',
      ),
    );
    expect(item('Method')).toBeInTheDocument();
    expect(fake.edits()).toHaveLength(1);
  });

  it('names a held retitle that cannot be sent because the author is signed out', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    fake.refuse(OUTLINE_URL, 401);
    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await typeTitle('s');
    await userEvent.click(item('Introduction'));
    release();

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'You are signed out, so the title Methods was not saved. Sign in again to change this document.',
      ),
    );
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Nothing is sent that could only be refused the same way.
    expect(fake.edits()).toHaveLength(1);
  });

  describe('two retitles held on two sections', () => {
    const V = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const retitled = (node: string, value: string) => ({
      operation: 'retitle',
      node,
      title: [{ type: 'text', value, marks: [] }],
    });

    /**
     * The reproduction, under StrictMode: a page-break change in flight; "s" typed into the title of
     * Method and Introduction clicked, which holds "Methods"; then "x" typed into the title of
     * Introduction and Enter, which holds "Introductionx". Nothing is sent until the act in flight is
     * answered.
     */
    async function holdTwo(fake: ReturnType<typeof service>) {
      open(fake.fetch);
      await screen.findByRole('treeitem', { name: 'Method' });
      await userEvent.click(item('Method'));
      const release = fake.hold();
      await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
      await waitFor(() => expect(fake.edits()).toHaveLength(1));
      await typeTitle('s');
      await userEvent.click(item('Introduction'));
      await typeTitle('x{Enter}');
      expect(fake.edits()).toHaveLength(1);
      return release;
    }
    const twoSections = () =>
      service(outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]));

    it('sends both once the act in flight is answered, in order, each from the version the one before made', async () => {
      const fake = twoSections();
      const release = await holdTwo(fake);
      release();

      expect(await screen.findByRole('treeitem', { name: 'Introductionx' })).toBeInTheDocument();
      await settled();
      expect(item(/^Methods/)).toBeInTheDocument();
      expect(fake.edits().map((request) => request.body)).toEqual([
        { openedFrom: V(1), operation: { operation: 'set', node: METHOD, pageBreak: 'page' } },
        { openedFrom: V(2), operation: retitled(METHOD, 'Methods') },
        { openedFrom: V(3), operation: retitled(INTRODUCTION, 'Introductionx') },
      ]);
      expect(screen.getByText('Version 0.4 in General')).toBeInTheDocument();
      expect(screen.getByRole('status')).not.toHaveTextContent(/not saved/);
      expect(shownTitle()).toBe('Introductionx');
    });

    it('drops both behind a refused act, and names both after the conflict sentence', async () => {
      const fake = twoSections();
      const release = await holdTwo(fake);
      fake.theirs({ operation: 'set', node: INTRODUCTION, pageBreak: 'recto' });
      release();

      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          `${SOMEBODY_ELSE} Your titles Methods and Introductionx were not saved.`,
        ),
      );
      await settled();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(fake.edits()).toHaveLength(1);
      expect(item('Method')).toBeInTheDocument();
      expect(shownTitle()).toBe('Introduction');
    });

    it('sends both behind an act that was not saved, since nothing they could overwrite was shown', async () => {
      const fake = twoSections();
      fake.refuseNext(OUTLINE_URL, 500);
      const release = await holdTwo(fake);
      release();

      expect(await screen.findByRole('treeitem', { name: 'Introductionx' })).toBeInTheDocument();
      await settled();
      expect(item('Methods')).toBeInTheDocument();
      expect(fake.edits().map((request) => request.body)).toEqual([
        { openedFrom: V(1), operation: { operation: 'set', node: METHOD, pageBreak: 'page' } },
        { openedFrom: V(1), operation: retitled(METHOD, 'Methods') },
        { openedFrom: V(2), operation: retitled(INTRODUCTION, 'Introductionx') },
      ]);
    });

    it('still names a title that was not saved once its field closed, after the next one is saved', async () => {
      const fake = twoSections();
      // The page-break change is the first request, Methods the second.
      fake.refuseRequest(2, 500);
      const release = await holdTwo(fake);
      release();

      expect(await screen.findByRole('treeitem', { name: 'Introductionx' })).toBeInTheDocument();
      await settled();
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          'The title Methods was not saved. Select the section and try it again.',
        ),
      );
      expect(fake.edits()).toHaveLength(3);
      expect(item(/^Method, starts/)).toBeInTheDocument();
    });

    it('sends neither once the author is signed out, naming the one whose field has closed', async () => {
      const fake = twoSections();
      fake.refuse(OUTLINE_URL, 401);
      const release = await holdTwo(fake);
      release();

      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          'You are signed out, so the title Methods was not saved. Sign in again to change this document.',
        ),
      );
      await settled();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(fake.edits()).toHaveLength(1);
      // Its field is still open, so what was typed is still there to send once signed in again.
      expect(shownTitle()).toBe('Introductionx');
    });
  });

  it('keeps what is typed after two commits to one field, whichever of them comes back first', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    // The first commit is sent and waits for its answer; the second is held behind it.
    const release = fake.hold();
    await typeTitle('s{Enter}');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await typeTitle('t{Enter}');
    await typeTitle('u');
    expect(fake.edits()).toHaveLength(1);
    release();

    expect(await screen.findByRole('treeitem', { name: 'Methodst' })).toBeInTheDocument();
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fake.edits().map((edit) => (edit.body as { operation: unknown }).operation)).toEqual([
      {
        operation: 'retitle',
        node: METHOD,
        title: [{ type: 'text', value: 'Methods', marks: [] }],
      },
      {
        operation: 'retitle',
        node: METHOD,
        title: [{ type: 'text', value: 'Methodst', marks: [] }],
      },
    ]);
    // Each title that came back was one this field sent, so nothing typed since is given away.
    expect(shownTitle()).toBe('Methodstu');
  });

  it('names each title a conflict took once, in one sentence', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));
    fake.theirs({ operation: 'set', node: INTRODUCTION, pageBreak: 'page' });

    // Methods is sent and waits; leaving the field after Enter commits the same text again, and
    // Introductionx is held behind it. The conflict refuses Methods, and Introductionx behind it.
    const release = fake.hold();
    await typeTitle('s{Enter}');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await userEvent.click(item('Introduction'));
    await typeTitle('x{Enter}');
    release();

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Introductionx were not saved\.$/),
    );
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByRole('status').textContent).toBe(
      `${SOMEBODY_ELSE} Your titles Methods and Introductionx were not saved.`,
    );
    expect(fake.edits()).toHaveLength(1);
  });

  it('names the title a conflict refused, and keeps the conflict sentence', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    fake.theirs({ operation: 'set', node: INTRODUCTION, pageBreak: 'page' });
    await typeTitle('s{Enter}');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        `${SOMEBODY_ELSE} Your title Methods was not saved.`,
      ),
    );
    expect(shownTitle()).toBe('Method');
  });

  it('says why an act does not apply, in the words the service gave', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    fake.refuse(OUTLINE_URL, 400, {
      code: 'outline_invalid',
      message: 'This change does not apply to the outline as it stands.',
      traceId: 't',
      reason: 'The position is past the end of these children',
    });
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'The position is past the end of these children.',
      ),
    );
    expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Method/);
    expect(screen.getByText('Version 0.1 in General')).toBeInTheDocument();
  });

  it('does not call a body the route would not take an outline that does not apply', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    fake.refuse(OUTLINE_URL, 400, { code: 'invalid_request', message: 'x', traceId: 't' });
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('The change could not be made.'),
    );
    expect(screen.getByRole('status')).not.toHaveTextContent(/does not apply|Try/);
  });

  it('clears the whole undo stack when an undo is refused as not applying', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method'),
        section(RESULTS, 'Results'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(screen.getByText('Version 0.2 in General')).toBeInTheDocument());
    await settled();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(screen.getByText('Version 0.3 in General')).toBeInTheDocument());
    await settled();

    fake.refuse(OUTLINE_URL, 400, {
      code: 'outline_invalid',
      message: 'x',
      traceId: 't',
      reason: 'The node is not in this outline',
    });
    await userEvent.keyboard('{Control>}z{/Control}');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'That change cannot be undone any more.',
      ),
    );
    // The entry beneath it was computed for a state that will now never exist, so it goes too.
    expect(undoable()).toBe(false);
    expect(fake.edits()).toHaveLength(3);
  });

  it('goes read-only, without claiming the caller may still read it, on a 404', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    fake.refuse(OUTLINE_URL, 404);
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'This document is no longer open to you.',
      ),
    );
    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
    expect(screen.queryByText('You may read this document but not change it.')).toBeNull();
  });

  it('says an act was not saved on a server error, and keeps an undo that did not arrive', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(screen.getByText('Version 0.2 in General')).toBeInTheDocument());
    await settled();

    fake.refuse(OUTLINE_URL, 500);
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'The change was not saved. Try it again.',
      ),
    );
    expect(screen.getByRole('tree')).toHaveTextContent(/Method[\s\S]*Introduction/);

    fake.fail(OUTLINE_URL);
    await settled();
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'The change was not undone. Try it again.',
      ),
    );
    expect(undoable()).toBe(true);

    // And trying again does work, because the entry was kept.
    fake.restore(OUTLINE_URL);
    await settled();
    item('Introduction').focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() =>
      expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Method/),
    );
    expect(undoable()).toBe(false);
  });

  it('reads the document again when a conflict carries no outline it can show', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    fake.theirs({
      operation: 'retitle',
      node: METHOD,
      title: [{ type: 'text', value: 'Methods', marks: [] }],
    });
    fake.refuse(OUTLINE_URL, 409, { code: 'version_precondition', message: 'x', traceId: 't' });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    expect(await screen.findByRole('treeitem', { name: 'Methods' })).toBeInTheDocument();
    expect(screen.getByText('Version 0.2 in General')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(SOMEBODY_ELSE);
  });

  it('says the document cannot be read when an answer carries an outline it cannot read', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    fake.refuse(OUTLINE_URL, 200, {
      ...fake.latest(),
      outline: { schemaVersion: OUTLINE_SCHEMA_VERSION, nodes: 'none' },
    });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    expect(await screen.findByText('This document could not be read.')).toBeInTheDocument();
    expect(screen.queryByText(/Reload/)).toBeNull();
  });

  it('names a reference to a component the caller may not read "A component", and still acts on it', async () => {
    const pinned: OutlineNode = {
      type: 'reference',
      id: RESULTS,
      component: PRINTER,
      mode: { kind: 'pinned', version: 'dddddddd-0000-4000-8000-00000000abcd' },
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [],
    };
    const fake = service(outline([section(INTRODUCTION, 'Introduction'), pinned]), {
      mayRead: () => false,
    });
    open(fake.fetch);

    const withheld = await screen.findByRole('treeitem', { name: 'A component, pinned' });
    expect(screen.queryByText(/may not read/)).toBeNull();
    // Moved, and given a page break, like any other node: its identifier is all an act needs.
    await userEvent.click(withheld);
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await settled();
    expect(screen.getByRole('tree')).toHaveTextContent(/A component.*Introduction/);
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'A new page');
    expect(
      await screen.findByRole('treeitem', { name: 'A component, pinned, starts on a new page' }),
    ).toBeInTheDocument();
    expect(fake.edits().map((edit) => (edit.body as { operation: unknown }).operation)).toEqual([
      { operation: 'move', node: RESULTS, parent: null, position: 0 },
      { operation: 'set', node: RESULTS, pageBreak: 'page' },
    ]);
  });

  it('names a reference "A component" when the listing was cut short, never one the caller may not read', async () => {
    const fake = service(outline([reference(RESULTS, 'latest')]), {
      components: {
        items: [
          {
            id: 'cccccccc-0000-4000-8000-000000000002',
            title: 'Replace the toner',
            space: { id: SPACE, name: 'General' },
            version: '0.1',
          },
        ],
        next: 42,
      },
    });
    open(fake.fetch);
    expect(
      await screen.findByRole('treeitem', { name: 'A component, latest' }),
    ).toBeInTheDocument();
  });

  it('keeps the page as it is when a drag starts, and offers the drop places a moment later', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    // Chromium ends a drag whose source changes in the same task it started in.
    fireEvent.dragStart(item('Introduction'));
    expect(screen.queryByText('Move to the end of the document')).toBeNull();
    expect(await screen.findByText('Move to the end of the document')).toBeInTheDocument();
    fireEvent.dragEnd(item('Introduction'));
    await waitFor(() => expect(screen.queryByText('Move to the end of the document')).toBeNull());
  });

  it('keeps Undo focusable once there is nothing left to undo', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(undoable()).toBe(true));
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(undoable()).toBe(false));
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled();
    // Pressed again with nothing to undo, it sends nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(fake.edits()).toHaveLength(2);
  });

  it('describes its keys, including what a Mac keyboard uses to remove', async () => {
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]));
    open(fake.fetch);
    const tree = await screen.findByRole('tree');
    const help = document.getElementById(tree.getAttribute('aria-describedby') ?? '');
    expect(help).toHaveTextContent(/Alt and the arrow keys/);
    expect(help).toHaveTextContent(/On a Mac keyboard, remove it with the Remove button/);
  });
});
