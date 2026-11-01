### Fixed

- **CT Studio's shared connection tests pass.** CT Studio tests a shared connection without naming an instance, and Alloy Works refused it as "This address serves no such instance". An unnamed instance now means the environment the address serves; a different one is still refused.
