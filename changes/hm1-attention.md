### Added

- **What waits on you.** `GET /v1/me/attention` answers, for the person signed in, what waits on them that they may resolve: a document whose latest publish of theirs failed, with the reason; a component holding changes of theirs not in a version; a document published from an earlier version; a connection not tested since its credential was set. Nothing they may not read is listed or counted.
