# Security policy

RealityGate runs locally, makes no network calls, and never reads `.env` file contents.

## Reporting a vulnerability

Please **don't** open a public issue. Use GitHub's private vulnerability reporting
(Security → Report a vulnerability) on this repository. You'll get a response within 7 days.

Especially relevant reports:
- a way a guard hook can be bypassed (e.g. a command that reads `.env` without being blocked);
- a way the scanner can be made to read secret files or write outside the project;
- a way `selftest --gate` can leave its canary file behind.

## How we keep RealityGate trustworthy

- Zero runtime dependencies and no install scripts (enforced by `tests/trust.test.mjs`).
- No network code in anything we ship, and a test-pinned list of files that start processes.
- Every push: the official Agent Skills validator (`skills-ref`), `claude plugin validate --strict`,
  and `realitygate scan-skills . --strict` on our own skills, hooks and scripts.
- npm releases are published from GitHub Actions with provenance.

## Supported versions

The latest released version.
