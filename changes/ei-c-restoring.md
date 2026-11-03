### Added

- **Restore an environment from its export.** Administration's Export now takes an archive back: it is checked first, as untrusted input, and says what it would do. Every sign-in provider and secret is answered for, and then all of it arrives, or nothing does. A whole export goes only into an empty environment.
- Its people, versions and audit log arrive as they were. The log's events keep their instants and are marked as restored, with their original numbers. Connections, model endpoints, extensions and webhooks arrive switched off, to be given their secrets afterwards.
- A restored environment holds its dates and reminders until someone has looked at what falls due.
- `import_environment`, a permission of its own, held by Administrators and by no token.
