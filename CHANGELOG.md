# Changelog

## Unreleased

## 0.3.0 — 2026-10-21

**Upgrading:** gates can go red on upgrade. New error rules: R-017 (env var missing from `.env.example`), R-019 (tests that can't fail, including a committed `.only`) R-021 (declared dependency missing from the lockfile; a stale lockfile fails) and R-022 (a service function or method whose whole body returns `null`). R-015 now flags routes that only decode input. Fix the code, or add a `justified: <reason>` comment where the rule allows it; an `exclude` or `disable` entry needs a reason and is listed under Not scanned. New warnings (R-018, R-020, per-test R-019) don't fail the gate. Scores can drop.

### Added
- `init --srs <file>` copies your SRS or requirements document into `docs/input/` (never overwrites it, refuses `.env*` files), and `doctor` reports whether any requirements input exists yet.
- `init` installs the six Build OS subagents (`planner`, `spec-critic`, `verifier`, `security-auditor`, `drift-auditor`, `researcher`) into `.claude/agents/`, from tested templates instead of having Phase 0 write them.
- Build OS: `start <path-to-SRS>` (asks where the SRS is when no path is given), `resume`, `prepare release` and `plan next release`; adopting an existing codebase (Phase 0.1b) instead of scaffolding over it; `docs/COSTS.md` with free-tier limits and a cost ceiling; `docs/RELEASE-READINESS.md` with the `CODE COMPLETE` / `RELEASE READY` / `LIVE DEPLOYED` states; the `DEFERRED` task status; and a standard run report.
- Executed vs inferred: the audit report (terminal, Markdown, JSON `checks`) keeps the static score apart from the checks that ran, each with its command and exit code. The rule self-test always runs; anything else that didn't run is `NOT RUN`, never a pass. `audit --exec` also runs the test command and a clean-install boot, and exits 1 if either fails. The test check reports how many tests passed, read from the runner's summary (node:test, Jest, Vitest, Mocha, pytest, `go test`), and fails a run where none passed even when it exited 0.
- `realitygate boot`: copies the project without `node_modules`, build output or `.env*` files, installs from the lockfile, and starts it with only the env vars in `.env.example` (real values from the environment, else the example's). Ready by `--ready <regex>`, `--probe "<cmd>"`, or 10 s without a crash. Commands can live under `run` in `realitygate.config.json`.
- R-017: env var the code reads (`process.env`, `import.meta.env`, `os.environ`, `os.getenv`, `os.Getenv`) that the nearest `.env.example` doesn't list. `audit` adds `ENV-NO-EXAMPLE` when code reads env vars and no example file covers it.
- R-018 (warning): exported functions, components, classes and consts that no other file mentions, with framework entry points, config-named files and convention exports skipped.
- R-019: tests that can't fail, read from test files only: empty bodies (JS/TS, Python, Go), assertions on a literal (`expect(true).toBe(true)`, `assert True`), test files with no assertion at all, and committed `.only`/`fit`. R-020 (warning): unconditional skips (`.skip`, `xit`, `@pytest.mark.skip`, `t.Skip` first). `check` prints how many test files it read; the audit charges both to the Tests category and reports how many test files contain an assertion. Gates can go red on upgrade if a suite has empty tests or a committed `.only`.
- R-022: JS/TS functions, class methods and arrows in `service.*`, `*.service.*` or `services/` files whose entire implementation returns `null` (F-024). A feature flag elsewhere doesn't hide the stub; a conditional `null` with a real path is allowed. Gates can go red on upgrade where a service is still a null stub.
- R-021: a declared dependency with no entry in the lockfile next to its manifest (or at a workspace root above it): npm, pnpm, yarn, bun, poetry, uv, pdm, Pipfile and go.sum. Offline, and closes R-014's gap where an agent invents a package and also declares it. No lockfile is a "can't verify" warning, not a pass. `check` prints how many manifests it read. The hallucinated-packages guide now says plainly that a lockfile entry proves a package exists, not that it's safe. Gates can go red on upgrade where a lockfile is stale.
- `check` and `audit` (terminal, Markdown, JSON `excluded`) print a **Not scanned** list: each `exclude` glob with its reason and file count, the built-in skip list, generated files, files outside the include targets, test files, disabled rules and R-018's skips. `disable` now also accepts `{ "id", "reason" }`.
- The audit lists every `justified:` comment with its reason (JSON `justified`), `check` prints the count, and the PR comment shows the count and its change against the base.
- `audit --compare <ref>` (score delta, new and fixed findings, from a temporary git worktree) and `--pr-comment=<file>`. The Action's `comment: true` posts or updates one PR comment; new inputs `exec`, `test-command`, `boot-*`, `comment`, `github-token`; new output `delta`.
- Change mode: `check --changed [--base <ref>]` gates only files changed since the merge base, with scope checks still on the whole project; a `change` track in `BUILD-OS.md`. When the change edits a dependency manifest (`package.json`, `requirements*.txt`, `pyproject.toml`, `Pipfile`, `setup.py`/`setup.cfg`, `go.mod`, `go.work`) or an env example, R-014 or R-017 is also rechecked in every unchanged file, and the output says so.
- `realitygate mcp`: read-only MCP server on stdio (`audit`, `check`, `proof`, `scan_skills`, `list_rules`), serving MCP 2026-07-28 requests and the older `initialize` handshake.
- Go support (`.go` sources, `_test.go`, R-013 `if err != nil {}` / `_ = err`, R-014 against `go.mod`) and deeper Python: R-014 against `requirements*.txt`, `pyproject.toml`, `Pipfile`, `setup.py`/`setup.cfg`; R-006 `# type: ignore`; R-007 `# noqa` / `# pylint: disable`; R-015 for Flask, FastAPI and Django handlers. Files whose header says `Code generated … DO NOT EDIT`, and `*.pb.go` / `*_pb2.py`, are skipped.
- Guides: use RealityGate with Spec Kit, OpenSpec and Superpowers.
- R-019 also judges each test on its own: a test with no assertion in a file whose other tests assert is a warning. Assertion-like helper names, functions defined in the file, test-support imports, `throw`, `await`, the test's own parameters and `cypress/`/`e2e/`/`playwright/` folders all count as a way to fail.
- Change mode warns when a change deletes (or renames away) a dependency manifest or env example, naming the check that it switched off, instead of going quietly green.
- The **Not scanned** list counts R-018's skips per file (entry files, files named by config, or "R-018 off" for a `"./*"` export) and says when R-014 is off because a language has no manifest.

### Fixed
- R-015 counted any `.parse(` or `.load(` call as validation, so `JSON.parse(await req.text())` or `json.load(request.files[...])` made an unvalidated route pass. Decoders such as `JSON`, `qs`, `yaml`, `pickle` and `json` no longer count; a schema's `.parse`/`.validate`/`.load` still does. Routes that only decoded input may now get R-015. A decoder under another name (`const p = JSON`, `import * as y from "yaml"`, `const q = require("qs")`, `import json as j`) doesn't count either.
- `boot` on Windows could fail to remove its temporary copy (`EPERM`) because the killed app still held its files. It now waits up to 5 s for the app to exit, and a copy it still can't remove is a warning, not a boot failure.
- R-019 could skip the first tests of a Python or Go test file read right after a file with no assertion, because a shared regex kept its position between files.
- The portable `realitygate-build` skill (Codex, Antigravity and other Agent Skills tools) was missing the "fill in IDEA.md" and "execute Phase 0" steps: they were dropped together with the plugin-only fallback line. A test now guards every skill against this.

### Changed
- R-014's label no longer says "package.json" (it covers Python and Go too). Scores can drop on upgrade: the example app goes from 33 to 31 (new env check), and JS/TS repos may see R-018 warnings.
- Removed the unused `toPosix` export from `src/files.mjs`, found by R-018.
- The `build` skill guides the start one question at a time and documents that Build OS commands are plain words, because `/status`, `/resume` and `/plan` are Claude Code built-ins and `/verify` is a bundled skill.

## 0.2.1 — 2026-10-20

### Changed
- The changelog no longer names the plugin icon's file path. Anthropic's plugin directory held the
  listing for review because a bundled image path appeared in backticks; no code changes.

## 0.2.0 — 2026-10-19

The GitHub Marketplace release tagged `v1.0.0` was published by mistake from the 0.1.0 code and
never reached npm. Release tags are immutable here, so it stays, but it is not a 1.0 release: use
`usmanmanii/realitygate@v0.2.0` or later.

### Added
- Project site at https://usmanmanii.github.io/realitygate/ with its own `llms.txt` and the three guides.
- Plugin icon for Anthropic's plugin directory listing.
- GitHub Flow contribution and release guidance, PR and issue templates, importable protection rulesets, and stable required CI checks.

### Fixed
- `scan-skills` no longer flags complete PNG, JPEG, GIF and WebP images as unreviewable binaries (S-013); it lists them instead. Renamed, truncated or padded files are still flagged.

### Security
- CI workflow runs with a read-only `contents: read` token.

## 0.1.0 — 2026-10-19

First release.

### CLI (`realitygate`, zero dependencies, Node ≥ 20)
- `audit`: Reality Score 0–100 across 7 weighted categories, findings, fix plan, README
  badge, `--md` report, `--json`, `--min-score` for CI.
- `check`: the Reality Gate with 16 built-in rules (R-001…R-016). Scans untracked files,
  fails on include targets matching zero files, never reads `.env` contents.
- `selftest`: a canary per rule plus a false-positive canary; `--gate "<cmd>"` plants a
  canary inside the project's scan scope and requires the real gate to go red.
- `hooks install`: four Claude Code `PreToolUse` guards (secrets, destructive git and
  red-gate commits, task allowlist, protected/applied-migration files).
- `init`, `doctor`.
- Custom `rules` / `fileRules` with canaries, `mayBeEmpty` with mandatory reasons,
  `exclude` with reasons.

### Proof, review and distribution
- `proof`: Proof Ledger. Checks each DONE task's journal for failing-test output, a green gate,
  an APPROVED final review, real execution output and an existing commit (named, or `[T-XXX]`
  in a commit message). Writes `PROOF.md` with a "tasks verified" badge; `--strict` for CI.
- `review-pack`: reviewer instructions + task spec + diff + new files (`.env*` excluded) for a
  reviewer from a different model family.
- Claude Code plugin + marketplace (`/plugin marketplace add usmanmanii/realitygate`) with five
  skills (audit, fix, gate, build, review) and the guard hooks. In plugin mode the secrets/git
  guards activate only in projects with `realitygate.config.json`. Passes `claude plugin validate`.
- GitHub Action (`usmanmanii/realitygate@v0.1.0`): audit report in the job summary, `score` and
  `grade` outputs, `min-score` gate.
- Every assistant: `agents install` writes portable Agent Skills to `.agents/skills/` (Codex,
  Antigravity CLI and other SKILL.md tools) and marked rule blocks in `AGENTS.md`, `GEMINI.md`,
  `.github/copilot-instructions.md`, plus `.cursor/rules/realitygate.mdc`. `hooks install --git`
  adds a pre-commit gate that blocks fake code from any agent (core.hooksPath aware, never
  overwrites a foreign hook). Guard scripts accept other assistants' tool and argument names.
- `scan-skills`: read-only red-flag scanner for any skill or plugin (S-001…S-016, modelled on the
  OWASP Agentic Skills Top 10), with an inventory of hooks, MCP servers, install scripts and
  process-spawning files; publisher exclusions always reported. New `scan` skill.
- Trust: tests enforce zero dependencies, no install scripts, no network code, a pinned list of
  process-spawning files, and Agent Skills spec compliance. CI runs `skills-ref validate`,
  `claude plugin validate --strict` and a strict self-scan. npm releases use provenance.
  Dependabot for Actions.
- Discoverability: `llms.txt`, `CITATION.cff`, three task-focused guides, issue templates.

### Build OS
- `BUILD-OS.md` v2: tracks (`quick` / `standard` / `full`), EARS acceptance criteria,
  CLI-backed gate, hook installation in Phase 0.
- `START-HERE.md`, `docs/IDEA.md` template, `docs/input/` drop zone.

### Quality
- 176 tests (`node --test`), CI on Linux/Windows/macOS × Node 20/22.
- Dogfooded: this repo scores 100/100 and its gate passes its own canary.
