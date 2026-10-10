import { createContext } from 'react';

/**
 * Where a component open in place keeps its strip, its toolbar and its second line (ADR-0056): the
 * band a document draws on the chrome above the desk, so the sheet does not move when one opens
 * (CNT-075). Null where there is none, and the editor keeps them in its card.
 */
export const InPlaceBand = createContext<HTMLElement | null>(null);
