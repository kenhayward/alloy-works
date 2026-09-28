// A hand-written stand-in for veraPDF's CLI in server mode, for the worker's own checker
// (src/verapdf.ts) to be tested against without a Java runtime: run by Node itself, which strips the
// types. It speaks what the pinned veraPDF speaks (testing/verapdf-server.ts): it writes a report for
// its empty start-up run and prints its path, then reads a PDF's path per line on stdin and answers
// each with the path of a report it wrote under `java.io.tmpdir`, which it reads from JAVA_OPTS as the
// JVM would.
//
// What it answers is decided by the PDF's bytes, so a test says what should happen by what it checks:
// `PASS` is compliant, `FAIL` fails two rules, `DIE` exits without answering, `STRAY` answers with a
// report outside its directory, and `ELSEWHERE` answers for another file. It notes each start, the
// names in the environment it was given and its JAVA_OPTS, and each report it writes, a line each, in
// the file FAKE_VERAPDF_LOG names. Given FAKE_VERAPDF_SILENT, it starts and never says it is ready, as a
// JVM that hangs on start would.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const tmpdir = /-Djava\.io\.tmpdir=(\S+)/.exec(process.env['JAVA_OPTS'] ?? '')?.[1];
if (tmpdir === undefined) {
  process.stderr.write('No java.io.tmpdir\n');
  process.exit(2);
}
const log = process.env['FAKE_VERAPDF_LOG'];
const note = (line: string) => {
  if (log !== undefined) appendFileSync(log, `${line}\n`);
};

const buildInformation = {
  releaseDetails: [
    { id: 'core', version: '1.30.2' },
    { id: 'apps', version: '1.30.2' },
  ],
};

let count = 0;
const reported = (name: string, result: object | null): string => {
  const path = join(tmpdir, `veraPDF-report-${++count}.json`);
  const jobs = result === null ? [] : [{ itemDetails: { name }, validationResult: [result] }];
  writeFileSync(path, JSON.stringify({ report: { buildInformation, jobs } }));
  note(`report ${path}`);
  return path;
};

const passed = {
  compliant: true,
  profileName: 'PDF/UA-1 validation profile',
  details: { failedRules: 0, ruleSummaries: [] },
};
const failed = {
  compliant: false,
  profileName: 'PDF/UA-1 validation profile',
  details: {
    failedRules: 2,
    ruleSummaries: [
      {
        clause: '5',
        testNumber: 1,
        description: 'The PDF/UA version and conformance level of a file shall be specified',
      },
      { clause: '7.1', testNumber: 10, description: 'DisplayDocTitle shall be true' },
    ],
  },
};

note(`started ${process.pid}`);
note(`env ${JSON.stringify(Object.keys(process.env).sort())}`);
note(`java-opts ${process.env['JAVA_OPTS'] ?? ''}`);
if (process.env['FAKE_VERAPDF_SILENT'] === undefined) {
  process.stdout.write(`${reported('', null)}\n`);
}

createInterface({ input: process.stdin }).on('line', (path) => {
  const pdf = readFileSync(path, 'latin1');
  if (pdf.includes('DIE')) process.exit(3);
  if (pdf.includes('STRAY')) {
    process.stdout.write(`${path}\n`);
    return;
  }
  const name = pdf.includes('ELSEWHERE') ? `${path}.elsewhere` : path;
  process.stdout.write(`${reported(name, pdf.includes('FAIL') ? failed : passed)}\n`);
});
