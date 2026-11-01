### Changed

- **A turn's footer says tokens and speed.** Under an answer, its tokens in and out and how fast it came, in tokens a second; its cost only where it had one, and no longer the month's runs. **Copy the answer** and **Ask again** are small icons.
- **Your question is said once**, in its bubble, never again as the conversation's title over it; a follow-up scrolls into view whole, its answer coming under it.
- **The assistant may make a hundred tool calls a run**, over as many as forty model turns.

### Fixed

- **The assistant's edits were refused when it named a block as it reads it, with its `#`**, so a run spent its tool calls retrying them. (#870)
