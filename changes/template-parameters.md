### Added

- **Template parameters.** A template can declare parameters: each with a name, a type, whether it is required, its permitted values or range, whether it may change later, and the document field it seeds or the query arguments it supplies. A parameter that feeds nothing is refused.
- **Documents made with parameters through the API.** Making a document from a template takes a value for each parameter, refuses a missing or invalid one by name, records them on the document and seeds the fields they feed. A document's parameters can be changed where the template allows it, and read back with who changed each and when.
