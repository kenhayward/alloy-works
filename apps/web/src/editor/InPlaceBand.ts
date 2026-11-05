import { createContext } from 'react';

/**
 * Where a component open in place keeps its toolbar: the row under the menus (ADR-0093), there before
 * one opens, so the sheet does not move when it does (CNT-075). Null where there is none, and the
 * editor keeps it in its card.
 */
export const InPlaceBand = createContext<HTMLElement | null>(null);
