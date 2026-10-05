#!/usr/bin/env bash
# The tests in this job's reports that passed only on CI's one retry (ADR-0039): each listed in the
# run's summary and given an open issue, or a comment on the one it already has. A flake never
# blocks, and is never forgotten.
set -u
run="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
pnpm -s trace flakes | while IFS= read -r flake; do
  [ -z "$flake" ] && continue
  echo "- Flaky, passed on a retry: \`$flake\`" >> "$GITHUB_STEP_SUMMARY"
  title="Flaky test: ${flake:0:180}"
  number=$(gh issue list -R "$GITHUB_REPOSITORY" --state open --search "$title in:title" \
    --json number,title | jq -r --arg t "$title" '.[] | select(.title == $t) | .number' | head -n 1)
  if [ -n "$number" ]; then
    gh issue comment "$number" -R "$GITHUB_REPOSITORY" --body "Again, in $run." > /dev/null
  else
    gh issue create -R "$GITHUB_REPOSITORY" --title "$title" \
      --body "Failed, then passed on CI's retry, in $run. Reproduce it before calling it a flake (docs/testing.md); fix it in its own PR." > /dev/null
  fi
done
exit 0
