# Home

Home is a page, not the only way between modules ([ADR-0046](../decisions/0046-the-ledger-interface.md)):
a greeting, the environment, and each module with its count, every count of what the reader may read.
This design adds **Needs your attention** (SCH-068), built by [the HM plan](../plans/2026-10-12-hm-waiting-on-you.md),
whose decisions are the detail. **Where you left off** (SCH-069) is T7's.

## Requirements owned

None yet: SCH-068 waits on the amendment below.

## What this document does not own

| Left unclaimed | Why                                                                                                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SCH-068        | **A named gap.** Its first item, "a document that cannot publish", is answered for the documents whose latest attempt by the person failed, from the stored failure; a full resolve on each Home is too costly. Claimed once Ken amends the item (the HM plan's challenge) |
| SCH-069        | Where you left off: T7's                                                                                                                                                                                                                                                   |

## Needs your attention

What waits on the person signed in that they may resolve, computed when Home asks
(`GET /v1/me/attention`), stored nowhere, each item with its reason and one action:

| Waiting                                              | Listed where the person                                                                                                      | The action                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| A document that cannot publish                       | may publish and read it, and their latest attempt failed, with no later publication they may read or made; the stored reason | Its Publishing panel                          |
| Their changes not in a version                       | may edit and read a component holding a retained iteration of theirs newer than any version holding it, not discarded        | The component, whose **Recover** resumes them |
| A publication of an earlier version                  | may publish and read a document whose latest publication they may read or made is of an older version than its latest        | Its Publishing panel                          |
| A connection not tested since its credential was set | may use and read a connection, not retired, whose credential is set and whose latest test is not of it                       | The connection, whose **Test** tests it       |

**Nothing they may not read is listed or counted** (SCH-032): each artifact is decided readable, and
for its act permitted, before it is listed; a title is read as they read it now. An item is gone once
the person does what it asks, judged by what they can see: a publication made, a version cut or the
changes discarded, a test run. One item per artifact, at most 20 with the total.
