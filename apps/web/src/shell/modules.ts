import { words, type WordKey } from '../words/words.js';
import type { ModuleName } from './moduleOf.js';

/** A module's name as the interface says it: its name is its identity, which addresses compare. */
export const moduleWords = (name: ModuleName): string => words(`module.${name}` as WordKey);

/** What a module is for, as Home says it. */
export const moduleAbout = (name: ModuleName): string => words(`module.${name}.about` as WordKey);

/** A group's name as the interface says it. */
export const groupWords = (group: ModuleGroup['group']): string =>
  words(`module.group.${group}` as WordKey);

/** A module as the rail, Home and search and commands name it. */
export interface Module {
  readonly name: Exclude<ModuleName, 'Search' | 'Administration'>;
  readonly href: string;
}

export interface ModuleGroup {
  readonly group: 'Author' | 'Publish' | 'Data';
  readonly modules: readonly Module[];
}

/** The modules, grouped as the rail and Home show them (ADR-0046, decision 3). */
export const MODULE_GROUPS: readonly ModuleGroup[] = [
  {
    group: 'Author',
    modules: [
      {
        name: 'Components',
        href: '#/components',
      },
      {
        name: 'Documents',
        href: '#/documents',
      },
      {
        name: 'Templates',
        href: '#/templates',
      },
      {
        name: 'Prompts',
        href: '#/prompts',
      },
      {
        name: 'Bibliography',
        href: '#/bibliography',
      },
      {
        name: 'Terms',
        href: '#/terms',
      },
      {
        name: 'Conversations',
        href: '#/conversations',
      },
    ],
  },
  {
    group: 'Publish',
    modules: [
      {
        name: 'Publications',
        href: '#/publications',
      },
    ],
  },
  {
    group: 'Data',
    modules: [
      { name: 'Connections', href: '#/connections' },
      {
        name: 'Query definitions',
        href: '#/query-definitions',
      },
    ],
  },
];

export const MODULES: readonly Module[] = MODULE_GROUPS.flatMap((group) => group.modules);
