import { beforeEach, describe, expect, it } from 'vitest';

import { forgetEditing } from './editing-storage.js';

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const SESSION = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';

/** What a window keeps while a component is edited in it, beside something that is not the editor's. */
function keepEditing() {
  sessionStorage.setItem(`alloy-works:editing-session:${COMPONENT}`, SESSION);
  sessionStorage.setItem(`alloy-works:editing-sessions:${COMPONENT}`, JSON.stringify([SESSION]));
  sessionStorage.setItem(`alloy-works:editing-steps:${COMPONENT}`, '{"kept":true}');
  sessionStorage.setItem(`alloy-works:editing-sent:${COMPONENT}:${SESSION}`, '{"sequence":3}');
  sessionStorage.setItem(`alloy-works:editing-offered:${COMPONENT}`, '{"text":"Kept."}');
  sessionStorage.setItem('alloy-works:pane-width', '320');
}

beforeEach(() => sessionStorage.clear());

describe('signing out (final review of W11.3, D2)', () => {
  it('forgets everything the editor keeps in this window, and nothing else', () => {
    keepEditing();
    forgetEditing();
    expect(Object.keys({ ...sessionStorage })).toEqual(['alloy-works:pane-width']);
  });
});
