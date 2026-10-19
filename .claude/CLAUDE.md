# RealityGate maintainer instructions

- Keep zero runtime dependencies; use Node 20 or newer standard library in shipped code.
- Never read or print `.env` contents.
- Verify external APIs, formats, and versions against official documentation before using them.
- For every new detection rule, add a canary, positive and negative tests, a README rule row, and a `FAILURES.md` entry. Treat false positives as bugs.
- Do not weaken tests or add exclusions to make a gate pass. Every exclusion needs a written reason and must be shown to users.
- Before reporting a change complete, run `npm test`, `node bin/realitygate.mjs check`, `node bin/realitygate.mjs selftest --gate "node bin/realitygate.mjs check"`, and `node bin/realitygate.mjs scan-skills . --strict`.

## Version control

- Wait for the user's explicit approval before any commit, push, pull request, GitHub settings change, tag, or release.
- Once approved, start a short-lived branch from `main` for each change and follow [CONTRIBUTING.md](../CONTRIBUTING.md).
- Use a Conventional Commit PR title and squash merge through a PR with the repository template.
- Never push directly to `main`, force-push, delete version tags, or skip hooks.
- Run the verification commands before requesting approval for version control or publishing actions.
