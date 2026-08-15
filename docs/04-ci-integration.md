# CI integration

After local development, CI is where this tool gets its repeated use. Everything here is designed around that: documented exit codes, a stable JSON schema, and a markdown format meant for a pull request comment.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No errors. Warnings only, without `--strict` |
| `1` | One or more errors found, or warnings with `--strict` |
| `2` | Config file invalid, or missing when passed explicitly with `--config` |
| `3` | Not a Next.js or React project |
| `4` | Internal error. Always accompanied by a message asking for an issue with the `--json` output |

## GitHub Actions

```yaml
name: Audit

on: [pull_request]

jobs:
  next-doc:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      # Bundle sizes need real build output. Without this step the performance
      # plugin reports that it could not measure, instead of guessing.
      - run: npm run build

      - name: Next Doc
        run: npx @hopp/next-doc --json > next-doc-report.json

      - name: Check for errors
        run: npx @hopp/next-doc --strict

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: next-doc-report
          path: next-doc-report.json
```

The first step always succeeds because it only writes the report. The second step is the gate. Split this way, you keep the machine readable artifact even on a failing run.

## Posting the report as a PR comment

```yaml
      - name: Build report
        id: report
        run: |
          {
            echo 'body<<EOF'
            npx @hopp/next-doc --markdown
            echo EOF
          } >> "$GITHUB_OUTPUT"

      - uses: peter-evans/create-or-update-comment@v4
        with:
          issue-number: ${{ github.event.pull_request.number }}
          body: ${{ steps.report.outputs.body }}
```

The markdown output is a heading, a score line, and one table per plugin with the rule code, the finding, the suggestion and the location.

## Gating on the score instead

```bash
SCORE=$(npx @hopp/next-doc --score)
if [ "$SCORE" -lt 80 ]; then
  echo "Score $SCORE is below the threshold of 80"
  exit 1
fi
```

`--score` prints a single number and nothing else.

## Gating on specific rules

Start strict on the rules you care about and leave the rest advisory:

```json
{
  "rules": {
    "PERF_UNOPTIMIZED_IMAGE": "off",
    "ENV_UNUSED_VAR": "off",
    "SECURITY_MISSING_CSRF": "error",
    "IDEM_UNPROTECTED_ROUTE": "error"
  }
}
```

Then run the whole thing with `--strict` only on the branch that deploys.

## Adopting on an existing codebase

A large project will light up on the first run. The way through it:

1. Run `npx @hopp/next-doc --json > baseline.json` and read the summary.
2. Turn off the rules you are not ready for, in `next-doc.config.json`.
3. Gate CI on the rest with `--strict`.
4. Turn rules back on one at a time as you fix them.

That beats a blanket `continue-on-error: true`, which is how a check becomes background noise nobody reads.

## GitLab CI

```yaml
next-doc:
  image: node:20
  script:
    - npm ci
    - npm run build
    - npx @hopp/next-doc --json > next-doc-report.json
    - npx @hopp/next-doc --strict
  artifacts:
    when: always
    paths: [next-doc-report.json]
```

## Pre-commit hook

```json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": "npx @hopp/next-doc env security"
  }
}
```

Two plugins rather than four: the env and security checks are fast and their findings are usually about the file you just touched. Save the full run for CI.

## Consuming the JSON

See [JSON schema](06-json-schema.md) for the full shape and the compatibility promise.

```bash
npx @hopp/next-doc --json \
  | jq -r '.results[].findings[] | select(.severity == "error") | "\(.file // "-"):\(.line // 0) \(.code) \(.message)"'
```
