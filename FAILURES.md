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

### F-014 — A generated copy of a skill silently lost two of its steps
**What happened:** the portable Agent Skills copy of `build` (for Codex, Antigravity and other
tools) is generated by dropping the plugin-only "outside the plugin" paragraph. In the source, that
line had no blank line before the next numbered steps, so "fill in IDEA.md" and "execute Phase 0"
were dropped with it. The copy shipped in 0.2.0 still looked complete.
**Why nothing caught it:** the sync test compared the copy with the generator's own output, so
both sides agreed on the missing steps.
**Caught by:** reviewing the generated copy while adding the SRS start.
**Now:** a test fails if any dropped fallback paragraph contains a numbered step, list item or
heading. It fails on the 0.2.0 source and passes on the fixed one.

### F-015 — The code read a secret nobody had written down
**What happened:** raised in launch feedback: AI-built apps read env vars such as
`process.env.STRIPE_SECRET_KEY` that appear nowhere in `.env.example`. Everything works on the
machine that generated the code, because the var is set there. A clean install or a new teammate
gets a crash, or worse, a silent `undefined`.
**Why nothing caught it:** every check looked at the code alone. None compared what the code
reads with what the project tells people to set.
**Now:** R-017 flags each var the code reads by name that the env example file doesn't list. It
skips vars that the OS, CI, the host or the framework set, and only runs when an example file
exists. When there's none, `audit` reports one project check (`ENV-NO-EXAMPLE`) listing the vars.
The example file is read; `.env` and `.env.local` never are.

### F-016 — The feature was built, compiled and never ran
**What happened:** raised in launch feedback: agents write a function or component, sometimes with
a test, and never wire it into the app. Typecheck passes and the tests pass, and the feature
doesn't exist for users. Running R-018 on the repo while building it found one such export in
RealityGate itself (`toPosix` in `src/files.mjs`), now removed.
**Why nothing caught it:** R-010 only sees commented-out code, `tsc` checks that calls resolve
but not that a function is called, and a test calling the function makes it look used.
**Now:** R-018 warns on named exports that no other file mentions, and says when only tests use
them. To keep false positives out it counts any mention as use, and it skips files and export
names that frameworks, `package.json` or config load by convention. It's a warning, so it lowers
the score but doesn't fail `check`.

### F-017 — A Go service with invented imports scored like a clean one
**What happened:** RealityGate only scanned `.js`/`.ts`/`.py` files, and its import check (R-014)
only knew `package.json`. A Go service was audited as "no source files". A Python service that
imported a package no manifest declared, which is exactly the slopsquatting risk, passed R-014,
because R-014 never looked at Python.
**Why nothing caught it:** the rules were written and tested on JS/TS, and Python support covered
only the text patterns (placeholders, secrets, `except: pass`).
**Now:** `.go` is source. R-014 checks Python against `requirements*.txt`, `pyproject.toml`,
`Pipfile` and `setup.py`/`setup.cfg`, and Go against `go.mod`, each only when that manifest
exists. To keep false positives out it allows the standard library, the project's own packages
and known renames such as `PIL` for Pillow, and it skips indented (optional) imports. Each
language variant has its own self-test canary. Python's `Any` was tried as part of R-008 and
dropped: run on a real typed backend it gave 61 hits, nearly all idiomatic.

### F-018 — Our own test check passed a project with no tests
**What happened:** before release, `audit --exec` marked the Test suite PASS on any exit code 0.
`node --test` exits 0 when it finds no test files, and so do Jest and Vitest with
`--passWithNoTests` and every runner we tried when all tests are skipped. A project with no
real tests got the same green check as one with a full suite. That's the false green the
executed checks exist to prevent.
**Why nothing caught it:** our tests for it used a command that exits non-zero, and nothing
asked "how many tests ran?". Writing the fix turned up a second hole: when RealityGate itself
runs under `node --test`, the inherited `NODE_TEST_CONTEXT` makes a project's `node --test`
skip every file and still exit 0.
**Now:** the check reads the runner's own summary (formats captured from real node:test, Jest,
Vitest, Mocha and pytest runs, and `go test`'s format strings in the Go source), reports the
number that passed, and fails a run where none did. An unrecognised runner still passes on exit 0,
but the report says the count is unknown. `NODE_TEST_CONTEXT` is no longer passed to the
project's test command.

### F-019 — Our own validation rule accepted `JSON.parse` as a schema
**What happened:** R-015 treated any `.parse(` call as schema validation. A route doing
`const body = JSON.parse(await req.text())` passed as "validated", although `JSON.parse` only
decodes text and accepts any shape. The Python side did the same with `.load(`, so
`json.load(request.files["f"])` or `yaml.load(request.data)` passed too.
**Why nothing caught it:** the tests checked that zod's `Schema.parse` counted, but no test
checked that a plain decoder didn't. Both use the same method name.
**Now:** R-015 looks at what `.parse`/`.validate`/`.load` is called on. Decoders (`JSON`,
`JSON5`, `qs`, `querystring`, `URL`, `yaml`, `toml`, `csv`, `json`, `pickle`, `marshal`…) don't
count; a schema object, a chained `z.object(…).parse(…)` or marshmallow's `schema.load(…)` still
does. Both R-015 canaries now plant a decoder-only route, and tests cover both directions.

*Follow-up:* a decoder under another name (`const p = JSON; p.parse(body)`, `import * as y from
"yaml"`, `const q = require("qs")`, `import json as j`) also counted as validation. Aliases are now
followed in source order, including an alias of an alias. Canary: `R-015 (alias)`.

### F-020 — "Add tests" was satisfied by tests that could never fail
**What happened:** asked to add tests, agents write `test("works", () => {})`,
`expect(true).toBe(true)`, a file of `render(<App />)` calls with no assertion, or a
`.skip` on the test that fails. Each one counted as a test file in RealityGate's Tests category,
the same as a real one, and a committed `.only`, which stops the rest of the suite from running,
went unnoticed too.
**Why nothing caught it:** every rule skipped test files on purpose, so test code was counted
but never read.
**Now:** R-019 reads test files (not fixtures, mocks or snapshots) and fails on empty test
bodies, assertions on a literal, test files with no assertion at all, and committed `.only`.
R-020 warns on unconditional skips; conditional ones (`skipIf`, `skipif`) pass. Patterns are
anchored to the start of a line, so a test written inside a fixture string isn't read as one.
Run over 132 test files in six local repositories (date-fns, an Angular library, a NestJS
API, a Python/TypeScript app and two smaller ones), they flagged nothing, and the files they
didn't judge were helpers with no tests in them. The audit now also reports how many test files contain an
assertion. R-019 has canaries in JS/TS, Python and Go, and R-020 has one.

### F-021 — Our own import check trusted an invented package once it was declared
**What happened:** R-014 checks imports against the manifest. An agent that invented
`react-magic-state` and *also* added it to `package.json` passed. The README and the
hallucinated-packages guide still sold R-014 as slopsquatting protection.
**Why nothing caught it:** the manifest was treated as ground truth, and there was no
registry lookup, by design (RealityGate never uses the network).
**Now:** R-021 requires every declared dependency to have an entry in the lockfile next to its
manifest, or at a workspace root above it, since only a real install writes one. It reads npm,
pnpm, yarn, bun, poetry, uv, pdm, Pipfile and go.sum lockfiles. The formats were checked against
files generated by npm 11, pnpm 11, bun 1.2, yarn 1 and uv, and against the go.sum and
Pipfile.lock docs. Without a lockfile it warns "can't verify" instead of passing.

On 99 local repositories, the first version flagged three projects whose `package.json` sat
under an unrelated parent folder that had its own lockfile. That was a false positive, so a
parent lockfile now counts only at a real workspace root. What remained were three true
positives: stale lockfiles missing packages that `package.json` declared, which `npm ci` would
also refuse. The README and the guide now say what an entry proves (the package exists) and what
it doesn't (that it's safe).

### F-022 — One real assertion hid the tests next to it that checked nothing
**What happened:** R-019 judged "no assertion" per file. A file with one asserting test and a
sibling like `test("adds again", () => { const r = add(2, 2); })` passed, because the sibling's
body wasn't literally `{}`. Separately, R-019 read Python and Go test functions with a shared
global regex whose position carried over from one file to the next, so after a file with no
assertion, the first tests of the next file could be skipped.
**Why nothing caught it:** the tests checked one file at a time, so the carried-over position
never showed up, and a per-test check had been left out as too likely to misfire.
**Now:** each test's body is read on its own, and a test with no assertion in a file whose other
tests assert is a warning. Anything that can fail the test counts: helpers named like assertions,
functions defined in the file, imports from test-support modules, `throw`, `await`, the test's own
parameters (`t`, `done`, fixtures), and anything in `cypress/`, `e2e/` or `playwright/`, where page
objects assert out of sight. Over 3,500 test files in local repositories (outside `venv` and
`node_modules`), the first version wrongly flagged a Cypress page-object suite, a test whose
`async()` had no space (the inner callback was read as the body), `SortTester.testSort(…)`
helpers and a `def test1` nested inside a test. All four are fixed and have tests. One warning
remained, and it was a real catch: an LRU cache test that calls `get` and checks nothing. The
regex position is reset after every use, with a test that runs files in a row. Canary:
`R-019 (per test)`.

### F-023 — Deleting the manifest made change mode quieter, not louder
**What happened:** `check --changed` rechecks R-014 when a manifest changes, but a deleted
`package.json` or `.env.example` didn't count as changed: only added, modified and renamed files
were listed. The rules it fed simply turned off, and the gate went green.
**Why nothing caught it:** a missing manifest has always meant "nothing to check against" in a
full scan, which is reasonable for a project that never had one, but not for a change that removes it.
**Now:** change mode also lists files deleted or renamed away since the base. A deleted manifest or
env example is a warning on that path, saying how many source files it covered and which rule no
longer checks them, and the R-014/R-017 recheck of unchanged files still runs.

### F-024 — A null-only service looked implemented behind a feature flag
**Reported by:** Abdul Rafay, in a public discussion of RealityGate.
**What happened:** a service method can exist and compile while its whole implementation is
`return null`. A feature flag can keep the path out of normal testing and review.
**Why nothing caught it:** R-002 looked for explicit stub wording; R-018 only warned when an export
appeared unused, so a referenced null-only method could pass the gate.
**Now:** R-022 fails JS/TS service functions, methods and arrows whose entire implementation
returns `null`. It covers `service.*`, `*.service.*`, and files under `services/`. A conditional
`null` result with a real implementation path is allowed. It does not infer whether a feature
flag is enabled or prove a user journey is wired up; tests for that flow are still needed.

---

## Add yours

Open an issue titled `Failure: <one line>` with: what the agent did (code snippet), why your
tools didn't catch it, and a suggested rule. If it's confirmed, it becomes a rule with a canary,
tests, and an entry here credited to you.
