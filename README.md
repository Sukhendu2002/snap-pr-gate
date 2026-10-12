# Snap PR gate

A GitHub Action that sends a pull request's diff, plus as much of the repo as fits in 384K tokens, to [SubQ Snap](https://docs.subq.ai/endpoints/decisions-api/). Snap answers **ship**, **needs_review** or **risky** in about a second, for about $0.015 per run at full context.

The verdict goes on the PR as a label (`snap:ship`, `snap:needs_review` or `snap:risky`) and into the job summary, with the probability of each verdict.

## Usage

1. Get an API key at [console.subq.ai](https://console.subq.ai).
2. Add it as a repository secret named `SUBQ_API_KEY`: **Settings → Secrets and variables → Actions → New repository secret**.
3. Add this workflow:

```yaml
# .github/workflows/snap-gate.yml
name: Snap PR gate
on: pull_request

permissions:
  contents: read
  issues: write         # create the snap:* labels
  pull-requests: write  # put the label on the PR

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # needed to diff against the base branch
      - uses: Sukhendu2002/snap-pr-gate@v1
        with:
          api-key: ${{ secrets.SUBQ_API_KEY }}
```

## Inputs

| Input | Default | |
|---|---|---|
| `api-key` | (required) | SubQ API key |
| `fail-on` | `risky` | Fail the check at this verdict or worse: `needs_review`, `risky` or `never` |
| `label` | `true` | Label the PR with the verdict |
| `github-token` | `github.token` | Token used to label the PR |
| `max-chars` | `1200000` | Character budget for the diff plus repo files |

The action also sets the outputs `verdict` and `confidence`.

## What Snap sees

It sends the diff first, then the files the PR changes, then the rest of the repo's code. Docs and tests come last. It stops when the budget is used up. Lockfiles, minified files and binaries are skipped.

## Before you use it

- The action sends your repo's code to SubQ. Don't run it on code you can't share with a third party.
- A PR author controls the diff, so they can write text in it that tries to talk Snap into answering "ship". Treat the verdict as a signal, not as the only thing standing between a PR and your main branch.
- PRs from forks get no secrets, so the check fails on them.
- If SubQ is down or rate-limited, the check fails. Add `continue-on-error: true` to the step if you don't want that to block merges.

## Development

```sh
node --test
SUBQ_API_KEY=... BASE_REF=origin/main node gate.mjs   # run against the current branch
```

## License

MIT
