### Added

- **What a publication holds from a model.** A publication now records each accepted generated suggestion and each component a model made that it printed, with the run each came from. Publications made earlier gain the same record. One accepted after publishing is never in it.

### Changed

- **A prompt writes only its component type.** A prompt declaring the type it writes is refused on a part of another type, before any model is called, and the Assistant offers only the prompts that fit the part open.
