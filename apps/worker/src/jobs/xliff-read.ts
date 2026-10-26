// A translation job's returned file read in a thread of its own (the XL plan, XL-F), so its memory and
// its time are bounded by the thread's limits and the job's timer rather than by the worker's. It
// imports packages alone, so it runs as it is written under Node's type stripping as well as built.
import { parentPort, workerData } from 'node:worker_threads';
import { readXliff } from '@alloy-works/readers/xliff';

const input = workerData as { readonly bytes: Uint8Array };
// Whatever the reading throws is the file's fault: the same bytes fail the same way every time.
try {
  const read = readXliff(input.bytes);
  parentPort!.postMessage(
    read.ok
      ? { ok: true, target: read.target, files: read.files }
      : { ok: false, refusal: read.refusal },
  );
} catch {
  parentPort!.postMessage({ ok: false, refusal: 'malformed' });
}
