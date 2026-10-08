import type { ModuleName } from './moduleOf.js';

/** A module as the rail, Home and search and commands name it. */
export interface Module {
  readonly name: Exclude<ModuleName, 'Search'>;
  readonly href: string;
  /** What it is for, as Home says it. */
  readonly about: string;
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
        about: 'Write and version the typed pieces documents are assembled from.',
      },
      {
        name: 'Documents',
        href: '#/documents',
        about: 'Build an outline of sections and component references, and publish it.',
      },
      {
        name: 'Templates',
        href: '#/templates',
        about: 'Starting outlines, themes and parameters.',
      },
    ],
  },
  {
    group: 'Publish',
    modules: [
      {
        name: 'Publications',
        href: '#/publications',
        about: 'Read what has been published. Kept exactly as it was made, never changed.',
      },
    ],
  },
  {
    group: 'Data',
    modules: [
      { name: 'Connections', href: '#/connections', about: 'Sources an environment owns.' },
      {
        name: 'Query definitions',
        href: '#/query-definitions',
        about: 'Values and tables documents bind.',
      },
    ],
  },
];

export const MODULES: readonly Module[] = MODULE_GROUPS.flatMap((group) => group.modules);
