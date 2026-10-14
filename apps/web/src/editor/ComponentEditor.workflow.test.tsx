import type { FollowOptions } from '@alloy-works/api-client';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { COMPONENT, json, open, opened, quick } from './test/componentEditor.js';

afterEach(() => {
  window.sessionStorage.clear();
});

const DRAFT = { key: 'draft', name: 'Draft', approved: false };
const IN_REVIEW = { key: 'in_review', name: 'In review', approved: false };
const APPROVED = { key: 'approved', name: 'Approved', approved: true };
const SUBMIT = {
  key: 'submit',
  name: 'Submit',
  to: { key: 'in_review', name: 'In review' },
  reasonRequired: false,
};

const header = () => screen.getByRole('group', { name: 'Component header' });

describe('workflow on a component’s own page (the WF1 plan, WF-G)', () => {
  it('shows the component’s state in its header, and moves it by a transition offered there', async () => {
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened({ state: DRAFT, transitions: [SUBMIT] })),
      'POST /v1/components/{id}/transitions': () =>
        json(200, { state: IN_REVIEW, transitions: [] }),
    });
    await surface();
    expect(within(header()).getByText('Draft')).toHaveAttribute('data-kind', 'draft');

    await userEvent.click(within(header()).getByRole('button', { name: 'Submit' }));
    expect(await within(header()).findByText('In review')).toBeInTheDocument();
    expect(within(header()).queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    expect(asked.find((each) => each.route.endsWith('/transitions'))?.body).toEqual({
      transition: 'submit',
      from: 'draft',
    });
  });

  it('says, before an approved component is saved, that saving starts a new draft', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened({ state: APPROVED, transitions: [] })),
    });
    await surface();
    expect(
      screen.getByText(
        'This is approved. Saving starts a new draft, and the approved version stays as it is.',
      ),
    ).toBeInTheDocument();
  });

  it('says nothing of a new draft to a reader who may not edit it', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () =>
        json(200, opened({ state: APPROVED, transitions: [], mayEdit: false })),
    });
    await surface();
    expect(screen.queryByText(/Saving starts a new draft/)).not.toBeInTheDocument();
  });

  it('follows the state its stream says it moved to, reading what the reader may take again', async () => {
    const streams: FollowOptions[] = [];
    let view = opened({ state: DRAFT, transitions: [SUBMIT] });
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, view) }, quick, false, {
      follow: (options) => {
        streams.push(options);
        return () => undefined;
      },
    });
    await surface();
    view = opened({ state: APPROVED, transitions: [] });
    act(() =>
      streams.at(-1)!.onEvent!('workflow', {
        artifact: COMPONENT,
        state: { key: 'approved', name: 'Approved' },
      }),
    );
    await waitFor(() => expect(within(header()).getByText('Approved')).toBeInTheDocument());
    expect(within(header()).queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });
});
