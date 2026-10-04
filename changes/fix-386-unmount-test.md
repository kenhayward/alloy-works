### Fixed

- **A test of the warning before leaving with unsaved changes no longer fails at random.** It now
  holds the save open while it checks the warning, so a slow test machine cannot finish saving
  before the warning is looked for.
