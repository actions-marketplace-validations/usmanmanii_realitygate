# TODO: known gaps

RealityGate's own rule is that a check must not claim more than it proves. This file lists where
it still does, or still misses something, so we fix it before a user finds it. Each item says
what's wrong, how we know, and the fix we have in mind. P1 items can mislead a user today.

## P1: can give a misleading result

- [x] **A test run with zero tests counts as PASS.** Fixed: the test check reads the runner's
  summary (node:test, Jest, Vitest, Mocha, pytest, `go test`), reports how many passed, and fails
  when none did. See FAILURES F-018. Remaining limit: an unrecognised runner still passes on exit
  0, with "count unknown" in the report; `go test` without `-v` gives packages, not tests.
- [x] **Empty or always-true tests make the Tests category look healthy.** Fixed: R-019 (empty
  bodies, literal assertions, files with no assertion, committed `.only`) and R-020 (warning,
  unconditional skips); the audit reports test files with assertions. See FAILURES F-020.
  Each test is now also judged on its own (warning, F-022), and a shared-regex bug that skipped
  tests in the next file is fixed. Remaining limits: a helper imported from an ordinary module with
  a plain name (`runCase(x)`) can't be followed, so such a test gets the warning (add
  `justified:`); a `describe` with no tests is left to the runner (Jest fails it); tests whose
  callback is a named function (`test("x", runCase)`) or an expression body aren't judged per test.
- [x] **R-015 counts `JSON.parse(...)` as validation.** Fixed: the receiver of `.parse`/
  `.validate`/`.load` decides; decoders (`JSON`, `qs`, `yaml`, `json`, `pickle`…) don't count.
  See FAILURES F-019. Renamed decoders (`const p = JSON`, `import * as y from "yaml"`,
  `import json as j`) are followed too. Remaining limit: a decoder reached through an object
  property or a function parameter (`const d = { p: JSON }; d.p.parse(x)`) still counts.
- [x] **Exclusions aren't shown in `check` or `audit` output.** Fixed: a "Not scanned" list in
  `check` and `audit` (terminal, Markdown, JSON) with each glob, reason and file count, the
  built-in skips, generated files, test files and disabled rules (`disable` takes reasons now).
  R-018's skips are counted per file too (entry files, files named by config, or "R-018 off" for
  a `"./*"` export). Remaining limit: convention export names are listed, not counted.
- [x] **`justified:` can be overused without anyone seeing it.** Fixed: the audit lists every
  justified line and its reason; `check` and the PR comment show the count (the PR comment also
  shows the change against the base).
- [x] **Change mode misses findings caused by manifest changes.** Fixed: a changed manifest
  rechecks R-014, and a changed env example rechecks R-017, in every unchanged file, with a note
  in the output. A deleted (or renamed-away) manifest or env example is now a warning saying
  which check it switched off (F-023), and the "Not scanned" list says when R-014 is off because a
  language has no manifest at all.
- [x] **R-014 passes an invented package once it's declared.** Fixed: R-021 (lockfile entry
  required; "can't verify" warning without a lockfile), and the guide and README say what an
  entry does and doesn't prove. See FAILURES F-021. Remaining limits: a hand-edited lockfile
  fools it; `requirements.txt` alone (no lock) can only warn; `bun.lockb` is binary and unread (the
  warning says to run `bun install --save-text-lockfile`; text `bun.lock` is read); Go
  `go.work` workspaces aren't followed (tracked under P2).

## P2: coverage gaps

- [ ] **Executed checks are Node-centric.** Test-command detection only knows a `package.json`
  `test` script, and boot only knows `npm start` and JS lockfiles. Python and Go projects get NOT
  RUN unless `run` is configured. *Fix:* detect `pytest` (pyproject/pytest.ini), `go test ./...`
  (go.mod), `uv sync`/`pip install -r`, `go build`, and Python/Go start commands.
- [ ] **Boot proves the app starts, not that the main flow works.** Readiness is a printed
  pattern, a user-supplied probe, or 10 s without a crash. *Fix:* document this limit in the
  report line, and add an optional smoke command list (`run.smoke`) recorded as executed checks.
  The main flow stays the job of the project's own e2e tests.
- [ ] **Boot runs in a temporary copy, not a sandbox.** It strips env vars and `.env` files but
  doesn't block network or the filesystem. *Fix:* say so in the docs and the report; optional
  Docker mode (`run.container`).
- [ ] **R-017 misses env access through config layers.** `@t3-oss/env`, `envalid`, zod env
  schemas, `pydantic-settings` `BaseSettings` and Vite `loadEnv` read vars without
  `process.env.X`, and dynamic `process.env[key]` is skipped. Platform-provided names are a fixed
  list. *Fix:* recognise the common schema libraries' field names; let `run`/config add provided
  names with a reason.
- [ ] **R-018 has blind spots.** It's name-based, so a common name mentioned anywhere (`get`,
  `handler`) counts as used. Default exports and whole files nothing imports aren't detected,
  and it's JS/TS only. *Fix:* resolve relative imports to files, flag unimported files, and add
  Python and Go.
- [ ] **Python R-014 leniency.** Any dependency with a `-`/`.` also allows its first segment
  (`python-dotenv` allows `python`), and the rename table is hand-kept. Transitive imports like
  `typing_extensions` are flagged, which is technically right but noisy. *Fix:* use package
  metadata when a lockfile exists (`poetry.lock`, `uv.lock` list top-level modules); drop the
  first-segment rule for non-namespace families.
- [ ] **Go R-014: `go.work` workspaces and module paths without a dot.** A module named `myapp`
  is treated like the standard library. *Fix:* read `go.work` `use` dirs; check the module list
  before the stdlib rule.
- [ ] **R-016 (cross-module repo imports) is JS/TS only.**
- [ ] **Secrets (R-011) is a fixed pattern list.** It has no Supabase service-role JWTs, no
  generic high-entropy strings and no `.npmrc`/`.pypirc` tokens. *Fix:* add the patterns behind
  canaries, and an opt-in entropy check as a warning.
- [ ] **No SARIF output.** GitHub code scanning can't show findings inline on the diff.
  *Fix:* `check --sarif <file>` and `audit --sarif`, plus an Action input to upload.
- [ ] **The badge shows only the static score.** Someone reading a README badge can't tell what
  ran. *Fix:* an optional second badge, "executed: 2/3 passed", from `audit --exec`.

## P3: robustness and polish

- [ ] **The Action's `exec` input runs the PR's code.** It's safe on `pull_request` (no secrets on
  forks) but dangerous on `pull_request_target`. *Fix:* refuse `exec: true` under
  `pull_request_target` unless explicitly overridden, and document why.
- [ ] **Fork PRs can't get the comment** (read-only token): today that's a warning only.
  *Fix:* document the `workflow_run` two-workflow pattern.
- [ ] **The MCP server reads any directory the user can.** It's read-only, but an agent could
  point it outside the project. *Fix:* an optional `--root` to restrict paths; tool timeouts for
  large repos.
- [ ] **Large monorepos:** R-018's usage index reads every text file, and scanning is
  single-threaded with no cache. *Fix:* measure on a large repo, then add a file-hash cache.
- [ ] **No test for `action.yml` itself.** *Fix:* run `actionlint` in CI, plus an end-to-end
  workflow test that runs the Action on the example app.
- [ ] **Self-test canaries for R-017 in Python and Go**, and R-008/R-009 equivalents where they
  make sense.
- [ ] **The `change` track isn't in the `build` skill or `doctor` yet.**
- [ ] **Known since 0.3.0:** Phase 0 creates `.claude/commands/status.md` and `verify.md`, which
  clash with Claude Code's `/status` built-in and `/verify` skill.

## Not verified in a real environment yet

- [ ] The Action's `comment: true` path: posting and updating a comment on a real PR.
- [ ] `realitygate mcp` in real clients: Claude Code (`claude mcp add`), Cursor, and a client that
  speaks MCP 2026-07-28.
- [ ] `realitygate boot` on Linux and macOS: process-group kill. It's been tested on Windows only
  (`taskkill`).
- [ ] The integrations in real Codex, Cursor, Copilot and Antigravity (carried over from the
  launch checklist).
