/**
 * Loaded before a suite child's entry, to make it slow to start, as a loaded runner's children are:
 * a second and a half before the entry is read. A child that counted its deadline from when it had
 * started would then reach it after the supervisor's kill, and never cancel its statement (DAT-109).
 */
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
