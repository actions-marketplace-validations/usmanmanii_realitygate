# Changelog

## Unreleased

## 0.2.0 — 2026-10-19

The GitHub Marketplace release tagged `v1.0.0` was published by mistake from the 0.1.0 code and
never reached npm. Release tags are immutable here, so it stays, but it is not a 1.0 release: use
`usmanmanii/realitygate@v0.2.0` or later.

### Added
- Project site at https://usmanmanii.github.io/realitygate/ with its own `llms.txt` and the three guides.
- Plugin icon (`.claude-plugin/icon.png`) for Anthropic's plugin directory listing.
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
