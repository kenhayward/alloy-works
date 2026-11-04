### Fixed

- The right-to-left pseudo-locale test opened its symbol palette from a caret that could land on the paragraph's index marker, where no symbol can be inserted; it now goes to the line's start - always plain text - before opening the palette from the Insert menu. Fixes #823.
