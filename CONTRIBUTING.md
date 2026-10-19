# Contributing

Thanks for helping make AI-built software real.

## The most valuable contribution: a failure story

Open an issue titled `Failure: <one line>`:
1. What the agent produced (minimal snippet).
2. Why existing checks didn't catch it.
3. A suggested rule or mechanism.

## Ground rules for code

- **Zero runtime dependencies.** Node ≥ 20 standard library only.
- **Every rule needs:** an ID, a label, a canary in `src/selftest.mjs`, positive *and*
  negative tests in `tests/rules.test.mjs`, a row in the README rule table, and a
  `FAILURES.md` entry naming the failure it prevents.
- **False positives are bugs.** A noisy gate gets switched off (see F-004). Add a test
  for the legitimate code your rule must not flag.
- **Hooks fail closed** and are tested by running them as real processes (`tests/hooks.test.mjs`).
- **Never read `.env` contents**, anywhere, for any reason.

## Branches and pull requests

Use GitHub Flow: start a short-lived branch from the latest `main`, open a pull request, and squash merge after the required checks pass. Keep `main` releasable. Choose a descriptive branch name such as `feat/reality-score`, `fix/import-alias`, `docs/releasing`, `chore/dependencies`, `refactor/scanner`, `test/hooks`, `ci/windows`, or `rule/R-017-new-check`. Release preparation uses `release/vX.Y.Z`.

Use a Conventional Commit title for the pull request and its squash commit: `type(scope): summary`, or `type!: summary` for a breaking change. Accepted types are `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`. Scope is optional and uses lowercase letters, digits, and hyphens. A `BREAKING CHANGE:` footer also marks a breaking change. Write the reason and any migration notes in the PR body.

Add user-facing changes to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md), using Keep a Changelog headings (`Added`, `Changed`, `Fixed`, `Removed`, or `Security`). Link the relevant issue when one exists. Use the PR template; the PR title becomes the squash commit title. Do not push directly to `main`, force-push it, or skip hooks.

Versions follow SemVer. A `feat` normally calls for a minor release and a `fix` for a patch release. Breaking changes call for a major release after 1.0; while the public API is still 0.x, they call for a minor release and explicit migration notes. Other types alone do not require a release. The maintainer decides when to publish and follows [the release checklist](docs/RELEASING.md).

## Before opening a PR

```bash
npm run verify     # tests + dogfood check + selftest
node bin/realitygate.mjs selftest --gate "node bin/realitygate.mjs check"
node bin/realitygate.mjs scan-skills . --strict
```

All green, or explain why not.

## Comparison corrections

If the README misrepresents your project, open an issue. We'll fix it within 48 hours and credit you.
