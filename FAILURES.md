# FAILURES.md — the museum of ways AI-built code fakes being done

Every rule in RealityGate exists because something went wrong without it. Each entry records
what happened, why nothing caught it, and the rule or mechanism that catches it now.

**Sources:** entries F-001 to F-010 come from building a real two-sided marketplace (mobile +
web + double-entry ledger) under the Build OS. F-011 and F-012 were caught by RealityGate's own
self-test while it was being built. Contributions welcome: see CONTRIBUTING.md.

---

### F-001 — The gate scanned zero files and reported "clean"
**What happened:** the reality-check listed source files with `git ls-files 'src/**/*.ts'`.
In that environment the pathspec matched nothing, so the scanner checked 0 files and
printed "clean".
**Why nothing caught it:** a green result looks the same whether 500 files or 0 were checked.
**Now:** `check` prints files scanned per target. Any include target matching zero files
**fails** unless it's in `mayBeEmpty` with a written reason. `selftest` fails on empty targets.

### F-002 — New files were invisible to the gate
**What happened:** the scanner listed only *tracked* files. A brand-new file is untracked
until the commit the gate is supposed to guard, so new code was never scanned before commit.
**Now:** files are listed with `git ls-files --cached --others --exclude-standard`. There's a test
for exactly this case.

### F-003 — A missing lint script looked like a passing lint
**What happened:** `pnpm -r --if-present lint` silently skipped two packages that had no
lint script. The gate said "lint ✓".
**Now:** the Build OS forbids `--if-present` in gates, and `doctor` warns when it finds it.

### F-004 — A gate that cried wolf got edited around
**What happened:** a regex rule for "cross-module repo import" also flagged a module importing
its *own* repo through an absolute alias, which is legal. A gate that cries wolf is a gate
people edit around, and that removes the protection along with the noise.
**Now:** R-016 compares the importing module with the imported one, and has tests for both cases.
False positives are treated as bugs, because a noisy gate ends up switched off.

### F-005 — Case-sensitive SQL check, lowercase SQL
**What happened:** the append-only check matched `UPDATE ledger_entries` but not
`update ledger_entries`.
**Now:** custom rules take `flags` (e.g. `"i"`), and the canary convention makes you prove the
rule fires on the form you actually write.

### F-006 — The rule only knew one way to write to the database
**What happened:** "money writes must post to the ledger" matched the ORM's `.insert(payments)`.
The repo wrote with raw `INSERT INTO payments` (the column-level grants required it), so the
rule never fired.
**Now:** `fileRules` triggers are plain regexes you write for *your* code paths, and each
needs a canary in the style you actually use.

### F-007 — The reviewer was unavailable, so the task sat in limbo
**What happened:** the adversarial reviewer subagent couldn't run (spend limit). The task was
neither done nor blocked.
**Now:** the Build OS has an explicit `AWAITING_REVIEW` status, prints the command to run the review
in another tool, and never self-approves.

### F-008 — "Docker not installed" was discovered after the build had started
**What happened:** a task needing a local container run was blocked because the machine had
no Docker, which nobody had checked during setup.
**Now:** Phase 0 has an environment probe that writes `.agent/ENVIRONMENT.md` and raises
blockers on day one.

### F-009 — Specs hardcoded migration numbers the tool then disagreed with
**What happened:** a task spec said `0005_tasks.sql`, but the migration tool assigned `0002`.
**Now:** specs never hardcode migration numbers. Applied migrations are listed in a manifest,
and the `guard-protected` hook makes them immutable to the agent.

### F-010 — Writing every task spec up front went stale
**What happened:** full specs written before the interfaces they depend on existed had to be
rewritten once those interfaces were real (that is how F-009 happened).
**Now:** the backlog holds one-line `INDEXED` entries, and full specs are written per wave against
the real interfaces.

### F-011 — Our own secret-exposure rule missed `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`
**What happened:** R-012 required a word boundary right after `SERVICE_ROLE`. In
`SERVICE_ROLE_KEY` the next character is `_`, which is a word character, so the most common real
leak pattern slipped through.
**Caught by:** `realitygate selftest`. The R-012 canary stayed silent and the self-test
reported the rule as broken before release.
**Now:** the pattern allows a suffix after the sensitive word, and the canary uses the real
variable name.

### F-012 — Our own gate canary was planted where the gate wasn't looking
**What happened:** `selftest --gate` planted a `.ts` canary, but this repo's gate scans only
`.mjs` files. The gate stayed green and the self-test reported it as broken. That was correct, but
the real fault was the canary's placement.
**Now:** the gate canary is placed inside the project's include globs, with a matching
file extension. There's a regression test for it.

### F-013 — Our own scanner flagged the plugin's icon as an unreviewable binary
**What happened:** S-013 flagged every file containing a zero byte. Adding the PNG icon that
Anthropic's plugin directory asks for turned `scan-skills . --strict` red on our own repo. A rule
that fires on every logo teaches people to ignore it.
**Caught by:** CI on the icon pull request (`trust` job and the self-scan test).
**Now:** complete PNG, JPEG, GIF and WebP files are listed as images, not flagged. The extension
must match the file signature and the file must end exactly where the format ends, so a renamed
executable, a truncated image or a payload appended after the image is still S-013. Tests cover both.

---

## Add yours

Open an issue titled `Failure: <one line>` with: what the agent did (code snippet), why your
tools didn't catch it, and a suggested rule. If it's confirmed, it becomes a rule with a canary,
tests, and an entry here credited to you.
