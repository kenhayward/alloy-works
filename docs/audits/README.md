# Audits

The records of the checks a person makes before a release, which no test can make: the editor audited
against WCAG 2.2 AA (CNT-177) and the Matterhorn Protocol's human checkpoints reviewed on the
publishing regression corpus (PUB-105). How to make each, and what goes in its record, is
[the audit guide](../guides/auditing-a-release.md).

One folder per release, named by its version, holding `wcag.md` and `matterhorn.md`, committed in the
release's pull request before its baseline cites them
([baselines](../specification/baselines/README.md), "Verification"). A release that claims what only a
run where Word is can verify adds that run's record, `word.md`, which its baseline cites by
`local-run`, and beside it `word.json`, the run's report as `pnpm trace record-run` reduces it - each
test's name and status, and nothing of the machine.

**A record is never edited afterwards.** Like a review in [`docs/reviews/`](../reviews/README.md), it
is evidence of what a person saw on the day they looked. What a later release finds goes in that
release's own record.

| Release  | WCAG 2.2 AA | Matterhorn |
| -------- | ----------- | ---------- |
| None yet |             |            |
