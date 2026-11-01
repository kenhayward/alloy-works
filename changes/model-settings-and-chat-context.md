### Added

- **A timeout for each model.** Models asks how long a call to a model may take, showing the default of 120 seconds; every call to it waits that long.
- **A model's type and what it supports.** Each model is an LLM or an embedding model, and says whether it calls tools and reads images. Embedding goes only to an embedding model, everything else only to an LLM, and a model that calls no tools is sent none.
- **Context for the assistant.** Ask about the current component, or give the assistant all the document's components.
- **A reply's progress.** While the assistant answers, the panel shows it is answering and how many tokens have arrived.

### Changed

- **Model lines act through icons.** Edit and Test are icon buttons, with Set key and Retire under More actions; Edit opens the model's settings beside its line.
- **The chat offers no embedding model.** Its endpoint list holds LLMs alone.

### Fixed

- **Confirm and embed failed every time.** The sample's run was recorded without an audit context, so the service refused it; it is now recorded as the administrator, and any failure says why.
