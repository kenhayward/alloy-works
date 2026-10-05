// Which suites a run's jobs test (ADR-0039), written as GitHub step outputs: `suites`, a JSON list
// of the five suites that have a job each, and `rest`, the Turborepo filters for every other
// package's tests in the build job. The full run reaches everything; a docs-only PR, nothing; any
// other PR, the packages it changes and every package that depends on them.
import { execFileSync } from 'node:child_process';

const SUITES = ['connector', 'service', 'db', 'web', 'worker'];
const scope = '@alloy-works/';

function affected() {
  const text = execFileSync('pnpm', ['exec', 'turbo', 'ls', '--affected', '--output=json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const json = JSON.parse(text.slice(text.indexOf('{')));
  return json.packages.items.map((each) => each.name);
}

let suites;
let rest;
if (process.env.DOCS === 'true') {
  suites = [];
  rest = '';
} else if (process.env.FULL === 'true') {
  suites = SUITES;
  rest = SUITES.map((name) => `--filter='!${scope}${name}'`).join(' ');
} else {
  const names = affected();
  suites = SUITES.filter((name) => names.includes(scope + name));
  rest = names
    .filter((name) => !SUITES.some((suite) => name === scope + suite))
    .map((name) => `--filter=${name}`)
    .join(' ');
}
console.log(`suites=${JSON.stringify(suites)}`);
console.log(`rest=${rest}`);
