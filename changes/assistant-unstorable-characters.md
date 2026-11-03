### Fixed

- **A stray character from a model no longer stops the assistant.** A tool call holding a character that cannot be stored is refused and the model asked to write it again, and a reply holding one keeps the rest of its words. Before, the run stopped and said the connector had failed.
