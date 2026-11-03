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
