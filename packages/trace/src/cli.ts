// The query surface over the committed corpus. Thin by design: what is worth testing lives in
// format.ts and state.ts, which are pure and tested without a process.
import { REPO_ROOT, compile } from './compile.js';
import { formatSearch, formatStats, formatTrace, nextIdentifier, search } from './format.js';
import { allTraces, traceOf } from './state.js';

const USAGE = `pnpm trace <command>

  show <ID>          one requirement: its statement, tranche, state and owning design
  search <term>      every requirement whose statement mentions the term
  area <XXX>         every requirement in an area, with its state
  next <XXX>         the next free identifier in an area
  stats              the whole corpus, by tranche and state
`;

function main(argv: string[]): number {
  const [command, argument] = argv;
  const model = compile(REPO_ROOT);

  switch (command) {
    case 'show': {
      if (argument === undefined) return fail('show needs an identifier, such as CNT-014.');
      const trace = traceOf(argument.toUpperCase(), model);
      if (trace === undefined) return fail(`No requirement ${argument} in the corpus.`);
      console.log(formatTrace(trace));
      return 0;
    }
    case 'search': {
      if (argument === undefined) return fail('search needs a term.');
      console.log(formatSearch(search(model, argument), argument));
      return 0;
    }
    case 'area': {
      if (argument === undefined) return fail('area needs a three-letter code, such as CNT.');
      const area = argument.toUpperCase();
      const traces = allTraces(model).filter((trace) => trace.requirement.area === area);
      if (traces.length === 0) return fail(`No area ${area} in the corpus.`);
      for (const trace of traces) {
        console.log(
          `${trace.requirement.id}  ${trace.state.padEnd(10)}  ${trace.requirement.statement}`,
        );
      }
      return 0;
    }
    case 'next': {
      if (argument === undefined) return fail('next needs a three-letter code, such as CNT.');
      console.log(nextIdentifier(model, argument.toUpperCase()));
      return 0;
    }
    case 'stats': {
      console.log(formatStats(model));
      return 0;
    }
    default:
      console.log(USAGE);
      return command === undefined ? 0 : 1;
  }
}

/** Writes to stdout, not stderr: `consoleGate` throws from console.error by design. */
function fail(message: string): number {
  console.log(message);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
