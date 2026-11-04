import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LOZENGE_KINDS, Lozenge, StateLozenge, stateWord, toneOf } from './Lozenge.js';

const NAMED = LOZENGE_KINDS.filter((kind) => kind !== 'state');

describe('a lozenge', () => {
  it('LIF-078 tells every state by its words and an icon, whatever its colour', () => {
    for (const kind of NAMED) {
      const { container, unmount } = render(<Lozenge kind={kind} />);
      const lozenge = container.querySelector('[data-lozenge]')!;
      expect(lozenge.textContent, kind).toBe(stateWord(kind));
      expect(lozenge.textContent, kind).not.toBe('');
      const icon = lozenge.querySelector('svg');
      expect(icon?.querySelector('path'), kind).not.toBeNull();
      expect(icon, kind).toHaveAttribute('aria-hidden', 'true');
      unmount();
    }
  });

  it('LIF-078 keeps a high-contrast mode telling it, with an edge in the system text colour', () => {
    const css = readFileSync(join(import.meta.dirname, 'States.module.css'), 'utf8');
    const forced = css.slice(css.indexOf('@media (forced-colors: active)'));
    expect(forced).toMatch(/\.lozenge\s*{[^}]*border-color:\s*CanvasText/);
  });

  it('holds its kind, tone and size as data, and takes the default size unasked', () => {
    render(
      <>
        <Lozenge kind="onHold" />
        <Lozenge kind="superseded" size="small" />
      </>,
    );
    const held = screen.getByText('On hold');
    expect(held).toHaveAttribute('data-kind', 'onHold');
    expect(held).toHaveAttribute('data-tone', 'warn');
    expect(held).toHaveAttribute('data-size', 'default');
    const old = screen.getByText('Superseded');
    expect(old).toHaveAttribute('data-tone', 'muted');
    expect(old).toHaveAttribute('data-size', 'small');
  });

  it('gives each state the tone the guide gives it', () => {
    expect(Object.fromEntries(NAMED.map((kind) => [kind, toneOf(kind)]))).toMatchObject({
      draft: 'neutral',
      inReview: 'info',
      approved: 'ok',
      effective: 'ok',
      published: 'ok',
      changedSince: 'warn',
      notApproved: 'warn',
      onHold: 'warn',
      returned: 'warn',
      pastReview: 'warn',
      superseded: 'muted',
      archived: 'muted',
      withdrawn: 'muted',
      retired: 'muted',
      resolved: 'muted',
      neverPublished: 'neutral',
      notYoursToRead: 'neutral',
    });
  });

  it('as a dot carries its words as its name and tooltip, and shows none', () => {
    const { container } = render(<Lozenge kind="approved" size="dot" />);
    const dot = screen.getByRole('img', { name: 'Approved' });
    expect(dot).toHaveAttribute('title', 'Approved');
    expect(dot.textContent).toBe('');
    expect(container.querySelector('[data-lozenge]')).toHaveAttribute('data-size', 'dot');
  });

  it('holds the facts a state is shown with, in the words given', () => {
    render(<Lozenge kind="superseded">Superseded by Issue 2</Lozenge>);
    expect(screen.getByText('Superseded by Issue 2')).toHaveAttribute('data-kind', 'superseded');
  });

  it('draws Draft in a dashed stroke', () => {
    const { container } = render(<Lozenge kind="draft" />);
    expect(container.querySelector('svg')).toHaveAttribute('stroke-dasharray', '3 3.2');
  });

  it('LIF-005 shows a state a tenant declares by its own name, a neutral square', () => {
    const { container } = render(<StateLozenge state={{ key: 'qc', name: 'Ready for QC' }} />);
    const state = screen.getByText('Ready for QC');
    expect(state).toHaveAttribute('data-kind', 'state');
    expect(state).toHaveAttribute('data-tone', 'neutral');
    expect(state).toHaveAttribute('data-content');
    expect(container.querySelector('[data-icon="state:state"]')).not.toBeNull();
  });

  it('LIF-005 shows a seeded state by the name its workflow gives it, in its kind', () => {
    render(<StateLozenge size="small" state={{ key: 'approved', name: 'Released' }} />);
    const state = screen.getByText('Released');
    expect(state).toHaveAttribute('data-kind', 'approved');
    expect(state).toHaveAttribute('data-size', 'small');
    expect(state).toHaveAttribute('data-content');
  });

  it('maps the keys a tenant may declare for the review tranche, and no other', () => {
    render(
      <>
        <StateLozenge state={{ key: 'returned', name: 'Sent back' }} />
        <StateLozenge state={{ key: 'in_approval', name: 'With signers' }} />
        <StateLozenge state={{ key: 'withdrawn', name: 'Pulled' }} />
      </>,
    );
    expect(screen.getByText('Sent back')).toHaveAttribute('data-kind', 'returned');
    expect(screen.getByText('With signers')).toHaveAttribute('data-kind', 'inApproval');
    expect(screen.getByText('Pulled')).toHaveAttribute('data-kind', 'state');
  });
});
