# Closing an environment

> For an administrator deciding to close an Alloy Works environment, and for whoever asks them what that means
> afterwards. What happens, when, what cannot be undone, and what is left.

Closing is deliberate and slow on purpose. For **30 days** it can be given up with nothing lost. After that, unless
a legal hold keeps it, everything in the environment is deleted within **1 day**, and that cannot be undone.

## Who can close one

Someone holding `close_environment`, `export_environment` and `export_audit`, signed in within the last ten minutes,
who types the environment's name. It is always a person, never an API token. In Administration, under **Export**:

1. Take a whole export, or decline one. Declining is recorded.
2. Type the environment's name, and close it.

The operator can also close an environment when a contract ends, from their command line, recording a notice. The
export is then offered rather than taken: those allowed in can take it during the 30 days. Only the operator can give
up a closure the operator began.

## What happens meanwhile

Only people holding `close_environment`, `hold`, or both export permissions can sign in, and they see only the closure,
the export and the legal holds. Everybody else is signed out at once. Tokens stop working. A change takes effect within
30 seconds on every instance.

| Capability               | Suspended                   | Closing or held            |
| ------------------------ | --------------------------- | -------------------------- |
| `signInAndApi`           | stops                       | those allowed only         |
| `sharedPublicationLinks` | stops                       | stops                      |
| `webhookDelivery`        | stops, kept and resumed     | stops, dropped at deletion |
| `backgroundWork`         | stops, caught up on lifting | stops, except the export   |
| `realtimeConnections`    | ends                        | ends                       |
| `modelEndpoints`         | stops                       | stops                      |
| `searchIndexes`          | stops, caught up on lifting | stops                      |
| `notificationDelivery`   | stops, kept                 | stops                      |
| `inFlightPublications`   | finishes within its lease   | finishes within its lease  |

Exports already taken are kept until deletion, whatever their usual seven days say.

## The timetable

| When                            | What happens                                                               |
| ------------------------------- | -------------------------------------------------------------------------- |
| Day 0                           | Closed. Those not allowed in lose their sessions.                          |
| Any time up to day 30           | Can be given up, and everything is as it was.                              |
| Day 30, nothing under a hold    | Deletion begins, and can no longer be stopped.                             |
| Day 30, something under a hold  | Held: everything is kept, and it can still be given up.                    |
| When the last hold is released  | Deletion begins, and can no longer be stopped.                             |
| Within 1 day of deletion begins | Its addresses, stored objects, credential, database schema and roles gone. |

**A legal hold keeps the whole environment**, not only what it names, because what is held depends on the rest. A
forgotten hold therefore keeps everything, for as long as it is forgotten, and nothing releases it unasked.

## What is left afterwards

A record in the operator's database: the environment's id and name, its organisation, the dates, and a report the
deletion wrote by checking, not by assuming. It says no schema and no roles were found, and no addresses, objects, store
credential or jobs. It names no person. The operator reads it with `steward report --tenant <id>`.

The environment's own audit log goes with the rest, so **take the export if you will need to show who did what**.

## What this does not promise

- **Backups.** The product keeps none of its own, but whoever runs your database and store may. Deletion reaches what
  is live; a copy in an operator's backups lasts as long as their retention says. Ask them, since that is the answer
  your lawyer will want, and it is not one this deletion can give.
- **Files somebody already took out.** Exports downloaded, publications sent and documents shared stay wherever they went.
- **Being told.** Nobody is emailed that an environment is closing. Those who visit see it.
