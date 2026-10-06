### Added

- **A connection can run as each person.** A PostgreSQL connection may now assert the person's own identity, by a role their database administrator made for them, so the database's own permissions and row-level rules decide what each person sees. Only queries built in the product run this way, and a connection whose own account can read data is refused at every run and named by its test.
