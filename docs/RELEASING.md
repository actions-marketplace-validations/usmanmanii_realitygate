# Releasing RealityGate

RealityGate uses SemVer and publishes one supported version at a time. Tag releases as `vX.Y.Z`; the tag must match `package.json` and `.claude-plugin/plugin.json`. While the version is 0.x, a breaking change increments the minor version and includes migration notes. A feature normally increments minor, and a compatible fix increments patch. After 1.0, breaking changes increment major. Documentation or maintenance changes do not require a release by themselves.

## Prepare the release PR

1. Start `release/vX.Y.Z` from the latest `main`. Use a PR title such as `chore(release): vX.Y.Z`.
2. Move relevant `Unreleased` entries in `CHANGELOG.md` into a dated `X.Y.Z` section and restore an empty `Unreleased` section. Describe breaking changes and migration steps.
3. Set the same version in `package.json`, `.claude-plugin/plugin.json`, and `CITATION.cff`; update `date-released` in `CITATION.cff` to the planned release date.
4. Update every `usmanmanii/realitygate@vX.Y.Z` reference in `README.md`, `skills/`, `agent-skills/`, and `docs/`. The current action references live in the README, the gate skill, its portable copy, and two guides. Edit `skills/gate/SKILL.md`, then run `node scripts/sync-agent-skills.mjs` to regenerate the portable copy.
5. Run the full local verification chain:

   ```bash
   npm test
   node bin/realitygate.mjs check
   node bin/realitygate.mjs selftest --gate "node bin/realitygate.mjs check"
   node bin/realitygate.mjs scan-skills . --strict
   ```

6. Review the package contents with `npm pack --dry-run`, inspect the PR, and squash merge only after `CI passed` and `PR title` succeed. The release version test guards the metadata and action references.

## Publish

1. Confirm `main` contains the release PR and the checks passed. Confirm the `NPM_TOKEN` repository secret is configured for npm publishing with provenance.
2. Create a GitHub Release targeting that exact `main` commit with tag `vX.Y.Z`; use the matching changelog section as release notes. Mark a prerelease only when that is intended. Publishing the GitHub Release triggers `.github/workflows/release.yml`.
3. Wait for the Release workflow to succeed. It rechecks the tag against the package and plugin versions, runs tests and scans, then publishes to npm with provenance. Verify the npm version and provenance link, and check the GitHub Release and Action instructions.

Published `v*` tags are immutable under the release tag ruleset. If a release is wrong, ship a new version; do not move or delete an existing tag. GitHub repository setup is documented in [GITHUB-SETTINGS.md](GITHUB-SETTINGS.md).
