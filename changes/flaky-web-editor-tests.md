### Fixed

- Two flaky editor tests. The cross-reference dialog test now waits for the dialog's own focus
  effect to land before asserting it, and the definition-list test waits for the save that holds
  the finished list rather than the first PUT to reach the transport, which under load can be an
  intermediate autosave. Fixes #763 and #507.
