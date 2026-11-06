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
  readonly group: 'Author' | 'Library' | 'Publish';
  readonly modules: readonly Module[];
}

/** The modules, grouped as the rail and Home show them (ADR-0046, decision 3). */
export const MODULE_GROUPS: readonly ModuleGroup[] = [
  {
    group: 'Author',
    modules: [
      {
        name: 'Documents',
        href: '#/documents',
      },
      {
        name: 'Components',
        href: '#/components',
      },
      {
        name: 'Templates',
        href: '#/templates',
      },
      {
        name: 'Prompts',
        href: '#/prompts',
      },
    ],
  },
  {
    group: 'Library',
    modules: [
      {
        name: 'Bibliography',
        href: '#/bibliography',
      },
      {
        name: 'Terms',
        href: '#/terms',
      },
      {
        name: 'Images',
        href: '#/images',
      },
    ],
  },
  {
    group: 'Publish',
    modules: [
      {
        name: 'Conversations',
        href: '#/conversations',
      },
      {
        name: 'Publications',
        href: '#/publications',
      },
    ],
  },
];

export const MODULES: readonly Module[] = MODULE_GROUPS.flatMap((group) => group.modules);

/** Places in Administration's Data group (ADR-0075), which search and commands still goes to by name. */
export const DATA_PLACES: readonly Module[] = [
  { name: 'Connections', href: '#/admin/connections' },
  { name: 'Query definitions', href: '#/admin/query-definitions' },
];
