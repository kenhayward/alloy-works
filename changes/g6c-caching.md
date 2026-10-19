### Added

- **Caching.** A prompt run you repeat on the same part, with nothing changed, reuses your own run of the last day at no cost, and says so; Run afresh calls the model. Nobody else's run is ever reused. Anthropic endpoints cache their instructions and context, and an endpoint can price tokens read from the cache.
