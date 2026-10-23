// An import's file read in a thread of its own (the IM plan, IM-C), so its memory and its time are
// bounded by the thread's limits and the job's timer rather than by the worker's. It imports packages
// alone, so it runs as it is written under Node's type stripping as well as built.
import { randomBytes } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { blockIdentifierFrom, proposeImport, type ImportLevels } from '@alloy-works/domain';
import { readImport, type ImportFileType } from '@alloy-works/readers/import';

const input = workerData as {
  readonly bytes: Uint8Array;
  readonly type: ImportFileType;
  readonly levels: ImportLevels;
};
const read = readImport(input.bytes, input.type);
if (!read.ok) {
  parentPort!.postMessage({ ok: false, refusal: read.refusal });
} else {
  const language = read.language ?? 'en';
  const { parts, anchors } = proposeImport(read.flow, input.levels, {
    language,
    direction: 'ltr',
    newIdentifier: () => blockIdentifierFrom(randomBytes(16)),
    comments: read.comments,
  });
  parentPort!.postMessage({
    ok: true,
    parts,
    anchors,
    report: read.report,
    title: read.title,
    language: read.language,
    references: read.references,
    identities: read.identities,
    images: read.images,
    properties: read.properties,
  });
}
