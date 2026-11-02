### Added

- **Commands in the assistant's box.** Type `/clear` to clear this conversation and start a new one, `/tools` for the tools the model can use and what each does, `/save` to save this conversation, and `/commands` for this list. They never reach the model.

### Fixed

- **The assistant's table edits are no longer refused over and over.** It is now told exactly which forms an edit takes, and a refused edit says what to take out and what to add, so it can correct itself instead of repeating "Arguments refused" until the run gives up.
- **The conversation keeps up as it goes.** A follow-up question and the answer coming under it stay in view without scrolling, until you scroll back to read; your next question brings you back.
- **Tokens are counted as they arrive, thinking too.** The count no longer stays at 0 while a model thinks or writes a tool call, and a prompt run now counts as a conversation does.
