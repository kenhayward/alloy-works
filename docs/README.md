# Alloy Works documentation

Internal documentation for the repository. None of it carries a version number - these documents
describe how the repo works today, and a PR that changes how it works updates them in the same PR.

| Document                                 | What it covers                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| [guides/](guides/)                       | How to do a thing end to end, written for somebody who has not done it before     |
| [architecture.md](architecture.md)       | Workspaces, the renderer/shell split, the platform bridge, data flow, packaging   |
| [development.md](development.md)         | Getting set up, the commands, how to run web and desktop                          |
| [testing.md](testing.md)                 | TDD, the suites, the pristine-output gate, what belongs where                     |
| [ci-and-releases.md](ci-and-releases.md) | The CI pipeline, why it is advisory today, versioning and the changelog           |
| [features.md](features.md)               | The canonical inventory of what the product does                                  |
| [decisions/](decisions/)                 | Architecture decision records - what was decided and what would change the answer |
| [design/](design/)                       | How each subsystem will be built, and which requirements each one answers         |
| [specification/](specification/)         | What the product is going to be - scope, detailed requirements, and the spikes    |
| [reviews/](reviews/)                     | Reviews of the specification, kept verbatim, and where each was answered          |

`guides/` is the only folder here written for a reader from outside the team - the others assume you
already know why the thing exists. A guide answers "how do I do this, and how do I read what comes
back", and it is allowed to repeat what a reference document states once, because a person following a
procedure should not have to assemble it from four places.

`reviews/` is the only folder here holding documents this repository did not write. They are inputs:
a review says what somebody found wrong or missing, and what was done about it lives in the document
it reviewed, in its change history. They are never edited afterwards to match what happened.

`specification/` and `design/` are the two folders that describe the product rather than the
repository - what it must do, and how it will be built. Everything else here is true today; those two
are true of the thing being built towards, and [features.md](features.md) stays the honest account of
the distance between them. A design document graduates: once its subsystem exists, it is what
somebody reads to understand it.

## Where the rules live

[`CLAUDE.md`](../CLAUDE.md) at the repo root is the working agreement: TDD, CI, branch and PR
process, and the conventions that are easy to get wrong. [`CONTRIBUTING.md`](../CONTRIBUTING.md) is
the same ground rules written for a human arriving at the repo for the first time. When they and
these documents disagree, `CLAUDE.md` is the one to fix.
