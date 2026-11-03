### Fixed

- Two flaky editor tests. The cross-reference dialog test now waits for the dialog's own focus
  effect to land before asserting it, and the definition-list test waits for the save that holds
  the finished list rather than the first PUT to reach the transport, which under load can be an
  intermediate autosave. Fixes #763 and #507.
- The connector's memory-ceiling test bound its child's peak at the 371 MiB measured on a quiet
  runner; a loaded CI runner sits a little above it. The bound is now 400 MiB, which still catches
  a pathology and still fits four runs beside the supervisor in the container. Fixes #553.
- The warm compile tests allowed 120s each; one took 121s on a loaded CI runner and timed out
  before its retry passed. Both now allow 180s. Fixes #722.
- Choosing a part in the outline while a document's placed components were still arriving left the
  page at the top: the text was not yet tall enough to reach the part, so the scroll was lost. The
  choice now waits for the texts, as following a link to a part does, and goes there once they have
  taken their room. Fixes #453 and #747.
- The five-hundred-node navigation test took 37s on a quiet machine and crossed the suite's 120s
  default on a loaded CI runner. It now allows 180s. Fixes #757.
- The canvas test that opens a component in place measured the text before the line holding an inline
  image had taken its size, so the image loading moved the text a few pixels between the two reads.
  The document now waits for every image to be sized before anything is measured, as opening a
  component already did. Fixes #639 and #640.
