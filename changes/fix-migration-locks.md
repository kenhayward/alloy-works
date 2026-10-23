### Fixed

- **Several environments can be created at once again.** Each migration now commits on its own, so creating environments together no longer runs the database out of shared memory.
