### Added

- **Conditions and profiles, through the API.** Declare a condition axis as a definition, with its permitted values. A document declares its profile, the values it takes on each axis, with `PUT /v1/documents/{id}/profile`. A publish keeps the text its profile selects and leaves out the rest before anything is numbered or referred to, and fails by name where text depends on an axis the profile does not set, unless the document accepts that. A publish or a preview may name another profile, and the publication records the one it was made under.
