import type { Module } from './modules.js';

type Drawn = Module['name'] | 'Home' | 'Admin';

/** Each module's mark, on a 16px grid, stroked in the text's colour. */
const PATHS: Readonly<Record<Drawn, readonly string[]>> = {
  Home: ['M2.5 7.5 8 3l5.5 4.5', 'M4 6.5V13h8V6.5', 'M6.6 13V9.6h2.8V13'],
  Components: [
    'M2.5 2.5h4.5v4.5H2.5z',
    'M9 2.5h4.5v4.5H9z',
    'M2.5 9h4.5v4.5H2.5z',
    'M9 9h4.5v4.5H9z',
  ],
  Documents: ['M3.5 2.5h5.5l3 3v8h-8.5z', 'M9 2.5v3h3', 'M5.5 8.5h5M5.5 11h5'],
  Templates: ['M2.5 3h11v10h-11z', 'M2.5 6.2h11', 'M6.2 6.2V13'],
  Publications: ['M3 3h10v10H3z', 'M3 10h10', 'M6 6.5h4'],
  Connections: ['M6 2v3.5M10 2v3.5', 'M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0z', 'M8 11.5V14'],
  'Query definitions': [
    'M3 4c0-1.1 2.2-1.8 5-1.8s5 .7 5 1.8v8c0 1.1-2.2 1.8-5 1.8s-5-.7-5-1.8z',
    'M3 4c0 1.1 2.2 1.8 5 1.8s5-.7 5-1.8',
    'M3 8c0 1.1 2.2 1.8 5 1.8s5-.7 5-1.8',
  ],
  Admin: ['M2.5 4.5h11M2.5 8h11M2.5 11.5h11', 'M5.5 3v3M10.5 6.5v3M7 10v3'],
};

export function ModuleIcon({ name }: { name: Drawn }) {
  return (
    <svg
      aria-hidden="true"
      width={18}
      height={18}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
