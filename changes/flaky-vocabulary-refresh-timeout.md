### Fixed

- **A flaky test on a loaded runner.** The test that refuses the values past the most a vocabulary holds was recorded as a flake (issue #861): on a busy CI runner its first attempt needed more than the default 5s timeout and was retried. The domain suite now gives itself 30s, as the other suites' configs do, and a refresh whose values are all ones the module made skips the final parse that only repeated checks already done.
