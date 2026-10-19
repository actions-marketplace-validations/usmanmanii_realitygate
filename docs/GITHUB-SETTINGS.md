# GitHub repository setup

Apply these settings once, after the workflow files have landed on `main` and the `CI passed` and `PR title` jobs have each run successfully on a pull request. Repository rules are enforced remotely; committing the JSON files alone does not activate them. Run the commands from a checkout with GitHub CLI authentication and repository administration access. Review the current settings and any existing rulesets first so you do not create duplicate or conflicting rules.

## Merge settings

```bash
gh api -X PATCH repos/usmanmanii/realitygate \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F allow_auto_merge=true \
  -F delete_branch_on_merge=true \
  -F allow_update_branch=true \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY \
  -F has_wiki=false \
  -F has_projects=false
```

This makes the Conventional Commit PR title the squash commit title. Keep the PR body useful: GitHub will copy it into the squash commit body. The branch ruleset allows zero required approvals for a solo maintainer, while still requiring a PR, passing checks, and resolved review threads. `CODEOWNERS` identifies the maintainer without requiring a review the author cannot give themselves.

## Security settings

```bash
gh api -X PATCH repos/usmanmanii/realitygate \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
gh api -X PUT repos/usmanmanii/realitygate/private-vulnerability-reporting
gh api -X PUT repos/usmanmanii/realitygate/vulnerability-alerts
gh api -X PUT repos/usmanmanii/realitygate/automated-security-fixes
```

Dependabot alerts (`vulnerability-alerts`) must be enabled before automated security fixes; otherwise GitHub answers HTTP 422. Alerts cover every manifest in the repository, including the deliberately broken `examples/vibe-coded-app`, whose outdated dependencies are part of the example and are never installed by RealityGate. Some security features depend on repository visibility and plan; inspect the API response and the settings page. Vulnerabilities should go through the private reporting link in `SECURITY.md`, not a public issue.

## Rulesets

Check that the required job names are exactly `CI passed` and `PR title`. Then import the JSON in **Settings → Rules → Rulesets → New ruleset → Import**, or run:

```bash
gh api -X POST repos/usmanmanii/realitygate/rulesets --input .github/rulesets/main.json
gh api -X POST repos/usmanmanii/realitygate/rulesets --input .github/rulesets/release-tags.json
```

The main ruleset requires squash-merged PRs and both checks. `CI passed` fails if any matrix run or the trust job fails or is skipped. Required checks are strict, so an out-of-date PR branch must be updated and checked again. The release tag ruleset prevents updates and deletion of `v*` tags. Neither ruleset has bypass actors; change a ruleset through repository administration if recovery is ever needed. Do not import the main ruleset before the required jobs exist, or merging can become blocked.

## Labels

Create or verify these labels: `bug`, `enhancement`, `documentation`, `failure-story`, `false-positive`, `rule`, `breaking`, and `good first issue`. The issue forms refer to `bug`, `enhancement`, `failure-story`, and `false-positive`; GitHub must have those labels before the forms are used.

```bash
gh label create bug --color d73a4a --description "Something is broken" --force
gh label create enhancement --color a2eeef --description "New feature or improvement" --force
gh label create documentation --color 0075ca --description "Documentation change" --force
gh label create failure-story --color d93f0b --description "AI-built code failure story" --force
gh label create false-positive --color fbca04 --description "Legitimate code was flagged" --force
gh label create rule --color 7057ff --description "RealityGate detection rule" --force
gh label create breaking --color b60205 --description "Breaking change" --force
gh label create 'good first issue' --color 7057ff --description "Good first contribution" --force
```

After setup, open a small PR and confirm both required checks appear, a failing or skipped check blocks merging, and the squash commit uses the PR title. See [RELEASING.md](RELEASING.md) before creating a version tag.

GitHub references: [repository settings API](https://docs.github.com/en/rest/repos/repos#update-a-repository), [repository rulesets API](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset), [ruleset import](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository), [GitHub CLI API input](https://cli.github.com/manual/gh_api).
