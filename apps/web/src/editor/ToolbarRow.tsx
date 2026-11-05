import { useLayoutEffect, useRef, useState } from 'react';

import { HeaderSlot } from '../shell/HeaderSlot.js';

/**
 * The element a page's toolbar is drawn into, made once and kept while the page lives. The header gives
 * up its slot while a page is kept hidden, and an editor told its band had gone would draw its toolbar
 * on the page instead: this one never goes, and only stops being shown.
 */
export function useToolbarHost(): HTMLElement {
  const [host] = useState(() => {
    const element = document.createElement('div');
    element.dataset['inplaceBand'] = '';
    return element;
  });
  return host;
}

/** Stands a page's toolbar host in the row under the menus, while the page is the one shown. */
export function ToolbarRow({ host }: { host: HTMLElement }) {
  return (
    <HeaderSlot name="toolbar">
      <Attached host={host} />
    </HeaderSlot>
  );
}

function Attached({ host }: { host: HTMLElement }) {
  const place = useRef<HTMLDivElement>(null);
  // Once for each host: moving an element, even to where it is, would lose the focus inside it.
  useLayoutEffect(() => {
    place.current?.appendChild(host);
  }, [host]);
  return <div ref={place} />;
}
