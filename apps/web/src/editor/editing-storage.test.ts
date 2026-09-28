import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { forgetEditing, markPage } from './editing-storage.js';

const MARK = 'alloy-works:editing-page';
const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const SESSION = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';

/** What a window keeps while a component is edited in it, beside something that is not the editor's. */
function keepEditing() {
  sessionStorage.setItem(`alloy-works:editing-session:${COMPONENT}`, SESSION);
  sessionStorage.setItem(`alloy-works:editing-sessions:${COMPONENT}`, JSON.stringify([SESSION]));
  sessionStorage.setItem(`alloy-works:editing-steps:${COMPONENT}`, '{"kept":true}');
  sessionStorage.setItem(`alloy-works:editing-sent:${COMPONENT}:${SESSION}`, '{"sequence":3}');
  sessionStorage.setItem('alloy-works:pane-width', '320');
}

const hide = () => window.dispatchEvent(new Event('pagehide'));

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  hide();
  sessionStorage.clear();
});

describe('a tab duplicated while editing (final review of W11.3, D1)', () => {
  it("marks session storage as this page's own while it is open, and unmarks it as it goes", () => {
    expect(markPage()).toBe(false);
    const mark = sessionStorage.getItem(MARK);
    expect(mark).not.toBeNull();
    // Asked again by the same page: the same answer, the same mark.
    expect(markPage()).toBe(false);
    expect(sessionStorage.getItem(MARK)).toBe(mark);
    hide();
    expect(sessionStorage.getItem(MARK)).toBeNull();
    // Reloaded: the next page finds nothing marked, and is no duplicate.
    keepEditing();
    expect(markPage()).toBe(false);
    expect(sessionStorage.getItem(`alloy-works:editing-session:${COMPONENT}`)).toBe(SESSION);
  });

  it("finds another open page's mark in a duplicated tab, and forgets every session id it copied", () => {
    keepEditing();
    sessionStorage.setItem(MARK, 'the page it was copied from');
    expect(markPage()).toBe(true);
    expect(sessionStorage.getItem(`alloy-works:editing-session:${COMPONENT}`)).toBeNull();
    expect(sessionStorage.getItem(`alloy-works:editing-sessions:${COMPONENT}`)).toBeNull();
    // What was kept stays, for the component to offer as text; and nothing of anybody else's goes.
    expect(sessionStorage.getItem(`alloy-works:editing-steps:${COMPONENT}`)).toBe('{"kept":true}');
    expect(sessionStorage.getItem('alloy-works:pane-width')).toBe('320');
    // Marked as this page's now, so it forgets nothing it uses from here on.
    expect(sessionStorage.getItem(MARK)).not.toBe('the page it was copied from');
    sessionStorage.setItem(`alloy-works:editing-session:${COMPONENT}`, SESSION);
    expect(markPage()).toBe(false);
    expect(sessionStorage.getItem(`alloy-works:editing-session:${COMPONENT}`)).toBe(SESSION);
  });

  it('marks it again when the page comes back from the back-forward cache', () => {
    markPage();
    const mark = sessionStorage.getItem(MARK);
    hide();
    const shown = new Event('pageshow');
    Object.defineProperty(shown, 'persisted', { value: true });
    window.dispatchEvent(shown);
    expect(sessionStorage.getItem(MARK)).toBe(mark);
  });
});

describe('signing out (final review of W11.3, D2)', () => {
  it('forgets everything the editor keeps in this window, and nothing else', () => {
    keepEditing();
    forgetEditing();
    expect(Object.keys({ ...sessionStorage })).toEqual(['alloy-works:pane-width']);
  });
});
