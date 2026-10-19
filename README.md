<div align="center">

# RealityGate

### Your AI agent says it's done. Prove it.

**A Reality Score for any AI-built codebase in 30 seconds, gates that fail the build on fake code,
guardrail hooks for Claude Code, and a spec-driven operating system with ready-made subagents
that takes a solo founder from an SRS or idea to a real, shipped product.**

[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![CI](https://github.com/usmanmanii/realitygate/actions/workflows/ci.yml/badge.svg)](https://github.com/usmanmanii/realitygate/actions/workflows/ci.yml)
![Dependencies: 0](https://img.shields.io/badge/dependencies-0-blue)
![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Works with](https://img.shields.io/badge/works%20with-Claude%20Code%20%7C%20Codex%20%7C%20Cursor-purple)
![Reality Score](https://img.shields.io/badge/Reality%20Score-100%2F100%20A-brightgreen)

[Install](#-install--pick-one) ·
[Try it in 30 seconds](#-try-it-in-30-seconds) ·
[What it catches](#-what-it-catches) ·
[Why it's different](#-what-makes-it-different) ·
[Comparison](#-how-it-compares) ·
[Build OS guide](#-the-build-os-idea--shipped-product) ·
[FAQ](#-faq)

</div>

**RealityGate** is an open-source, zero-dependency **CLI, Claude Code plugin and GitHub Action**
that proves whether AI-generated ("vibe-coded") code is real. It gives any JavaScript, TypeScript
or Python repository a **Reality Score from 0 to 100**. It fails the build on stubs, placeholder
code, fake data, **hallucinated npm packages**, leaked secrets and unvalidated API routes, proves
its own checks can fail, keeps a **Proof Ledger** of how every task was verified, and ships a
spec-driven **Build OS** that takes a solo founder from an **SRS** or idea to a shipped MVP on a
near-zero budget, with six ready-made subagents doing the planning, review and research.

| At a glance | |
|---|---|
| Works with | Claude Code (plugin) · Codex · Antigravity / Gemini CLI · Cursor · GitHub Copilot · any CI or git workflow |
| Install | Claude Code plugin · `npx realitygate` · GitHub Action · Agent Skills · git pre-commit |
| Commands | `audit` · `check` · `selftest` · `proof` · `review-pack` · `scan-skills` · `agents install` · `hooks install` · `init [--srs]` · `doctor` |
| Build OS | Start from your SRS · 6 subagents · cost estimate with free-tier limits · release-readiness states · resumes from disk |
| Languages | JavaScript, TypeScript (incl. monorepos), Python (partial) |
| Rules | 16 built-in + your own, each proven by a planted canary |
| Privacy | Runs locally · no network · no telemetry · never reads `.env` contents |
| Dependencies | 0 (Node ≥ 20 standard library) |
| License | MIT © Muhammad Usman |

### 🆕 New in v0.3.0: start from your SRS

- **Say "start docs/SRS.pdf"** to `/realitygate:build` (or run `npx realitygate init --srs <file>`).
  No path? It asks where your SRS is, or helps you write the idea down, then goes one step at a time.
- **Six subagents installed for you** in `.claude/agents/`: `planner`, `spec-critic`, `verifier`,
  `security-auditor`, `drift-auditor` and `researcher`.
- **Built for one person on a small budget:** `docs/COSTS.md` lists every service's free-tier
  limit, a rough cost at ~10,000 users and a cost ceiling ($0/month until you raise it).
- **Honest finish line:** `ship` writes `docs/RELEASE-READINESS.md` and ends in exactly one state:
  `CODE COMPLETE`, `RELEASE READY` or `LIVE DEPLOYED`.
- **Existing apps too:** Phase 0 adopts your current code instead of scaffolding over it.

Details: [The Build OS](#-the-build-os-idea--shipped-product) · [CHANGELOG](CHANGELOG.md)

---

## The problem

Vibe coding gets you a demo in an afternoon. A product usually doesn't follow, because AI
agents are very good at code that *looks* finished:

```ts
// TODO: integrate Stripe properly
export async function chargeCard(amount: number) {
  // for now, pretend every payment succeeds
  return { ok: true };
}
```

Stubs, invented npm packages, `catch {}` blocks that swallow failures, a service-role key
exposed to the browser, routes that trust any input, zero tests, and an agent reporting
"✅ all done". Spec-driven tools help the agent plan. **Nothing checked whether what it
built is real. Until now.**

---

## 📦 Install: pick one

### 1. Claude Code plugin (easiest: everything, in plain English)

```
/plugin marketplace add usmanmanii/realitygate
/plugin install realitygate@realitygate
```

On Claude Code 2.1.275 or later, one line works too:
`/plugin install realitygate --marketplace usmanmanii/realitygate`

Then just talk to Claude. The plugin's skills trigger on their own:

| Say this | Skill that runs |
|---|---|
| *"Is my app production ready?"* · *"audit this code"* · *"what's my reality score?"* | `/realitygate:audit` |
| *"Fix the audit findings"* · *"make this app real"* | `/realitygate:fix` |
| *"Stop fake code reaching main"* · *"protect my .env"* · *"add a quality gate to CI"* | `/realitygate:gate` |
| *"Start docs/SRS.pdf"* · *"Build an app from my idea"* · *"continue"* · *"ship"* (Build OS projects) | `/realitygate:build` |
| *"Get a second-opinion review"* · *"prove this task was really done"* | `/realitygate:review` |
| *"Is this skill / plugin safe to install?"* | `/realitygate:scan` |

The plugin also brings the guardrail hooks. They activate only in projects that opted in by
having `realitygate.config.json` (create it with `/realitygate:gate` or `realitygate init`).

### 2. One-off from the terminal (no install)

```bash
npx realitygate audit                       # once published to npm
npx github:usmanmanii/realitygate audit     # works straight from GitHub today
```

### 3. GitHub Action (every push and PR)

```yaml
# .github/workflows/reality.yml
name: RealityGate
on: [push, pull_request]
jobs:
  reality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: usmanmanii/realitygate@v0.2.1
        with:
          min-score: 80      # fail below 80 (0 = report only)
```

The full audit report is written to the job summary. Outputs: `score`, `grade`.

### 4. Skills without the plugin

Copy any folder from [`skills/`](skills) into `~/.claude/skills/` (personal) or
`.claude/skills/` (project). Each skill falls back to `npx realitygate` when it isn't running
inside the plugin. The `SKILL.md` files use the standard `name` + `description` frontmatter.

### 5. Codex, Antigravity / Gemini CLI, Cursor, GitHub Copilot

```bash
npx realitygate agents install       # skills + instruction files for every assistant
npx realitygate hooks install --git  # pre-commit gate: blocks fake code from ANY agent
```

| Assistant | What gets installed | How you use it |
|---|---|---|
| **OpenAI Codex** | `.agents/skills/realitygate-*/SKILL.md` + `AGENTS.md` block | Type `$realitygate-audit` or `/skills`, or just ask *"is my app production ready?"* |
| **Antigravity CLI** (Gemini CLI's successor) | `.agents/skills/realitygate-*` + `AGENTS.md` / `GEMINI.md` blocks | Ask in plain language; the skills and rules load automatically |
| **Gemini CLI** (legacy) | `GEMINI.md` block | Rules load as context; run the commands it suggests |
| **Cursor** | `.cursor/rules/realitygate.mdc` (always applied) | The agent follows the rules and runs `realitygate check` before finishing |
| **GitHub Copilot** | `.github/copilot-instructions.md` block | Copilot Chat and the coding agent follow the rules |
| **Any agent, any human** | git `pre-commit` hook | Every commit runs the Reality Gate; fake code can't be committed |
| **Any CI** | GitHub Action or `npx realitygate check` | Fake code can't be merged |

The skills in [`agent-skills/`](agent-skills) follow the open Agent Skills `SKILL.md` format, so
other tools that support it can use them directly. Existing `AGENTS.md`, `GEMINI.md` and
Copilot instruction files are kept: RealityGate only adds or updates its own marked block.

**Honest compatibility note:** the real-time guardrail *hooks* (blocking `.env` reads and
destructive git as they happen) are Claude Code-specific. For every other assistant,
enforcement comes from the pre-commit gate and CI, which check the result rather than each action.

### 6. Global CLI

```bash
npm install -g realitygate && realitygate --help   # after the npm release
```

---

## ⚡ Try it in 30 seconds

No install, no config, no account. Zero dependencies.

```bash
npx github:usmanmanii/realitygate audit            # audit the current folder
npx github:usmanmanii/realitygate audit path/to/app --md   # + full REALITY-AUDIT.md report
```

> Once published to npm: `npx realitygate audit`. Requires Node ≥ 20.

Real output on [`examples/vibe-coded-app`](examples/vibe-coded-app), a small app with the
mistakes AI agents commonly ship:

```
REALITY AUDIT — vibe-coded-app    Reality Score: 33/100 (F)
scanned 3 source files · 0 test files

  Category                 Score    Issues
  ✗ Fake code                 0/20    8
  ✗ Hallucinated imports      5/15    2
  ✗ Security                 12/25    2
  ! Error handling            6/10    2
  ! Type safety               8/10    3
  ✗ Tests                     0/15    2
  ✗ Hygiene                  1.8/5    3

Findings (18 of 18)
  ✗ app/api/orders/route.ts:2   R-014 import of a package not declared in any package.json
      import "next-email-magic"
  ✗ app/api/orders/route.ts:7   R-012 secret exposed to the client via a public env prefix
      process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!,
  ✗ app/api/orders/route.ts:11  R-015 route reads request input without schema validation
  ✗ app/api/orders/route.ts:14  R-013 swallowed error (empty catch / catch returning nothing)
      .catch(() => {})
  ✗ lib/payments.ts:3           R-004 simulated implementation ("for now", "in a real app", …)
      // for now, pretend every payment succeeds
  ✗ lib/payments.ts:9           R-002 stub implementation
      throw new Error("Not implemented");
  …

Fix plan
  1. URGENT: rotate exposed credentials, move secrets to the host's env store, …
  2. Resolve 2 undeclared import(s): add the real package or remove the invented one …
  3. Replace 8 stub/placeholder/hardcoded-example occurrence(s) with real implementations …
  …

Badge for your README:
  ![Reality Score](https://img.shields.io/badge/Reality%20Score-33%2F100%20F-red)
```

For comparison, the (in-progress) production codebase this kit was extracted from, built under
the Build OS, scores **100/100**, and so does this repo.

---

## 🧰 What's in the box

| Tool | What it does | Who it's for |
|---|---|---|
| **`realitygate audit`** | Reality Score 0–100 for any repo, with findings, a fix plan and a README badge | Anyone with an AI-built app (Lovable, Bolt, v0, Cursor, Replit, Claude Code…) |
| **`realitygate check`** | **The Reality Gate.** Exit 1 on fake code, hallucinated imports, leaked secrets, unvalidated routes. Put it in CI | Any project using AI agents |
| **`realitygate selftest`** | Proves every check **can fail**: plants a violation per rule, and with `--gate` plants one in your project and requires your real gate to go red | Anyone who doesn't trust a green checkmark |
| **`realitygate proof`** | **Proof Ledger.** For every DONE task, checks the journal for real evidence: failing tests first, green gate, APPROVED review, real execution, an existing commit. Writes `PROOF.md` + a "tasks verified" badge | Founders, agencies, reviewers: anyone who needs to *show* how AI-built code was verified |
| **`realitygate review-pack`** | Bundles reviewer instructions + task spec + diff for a reviewer from a **different model family** (Claude builds, Codex reviews, or the reverse) | Anyone who doesn't want an AI grading its own homework |
| **`realitygate hooks install`** | Claude Code guardrails: the agent physically can't read `.env`, force-push, `reset --hard`, edit files outside its task, or modify applied migrations | Claude Code users |
| **`realitygate init` + `BUILD-OS.md`** | A spec-driven OS: your SRS, idea and research → spec → architecture → test-first build loop with adversarial review → ship → post-launch. `--srs` adds your SRS; installs six subagents | Solo founders and vibe coders building a new product or finishing an existing one |
| **`realitygate doctor`** | Checks the whole setup is wired correctly | Everyone using the OS |

---

## 🔒 Trust & safety

Malicious skills and plugins are a real problem: OWASP's
[Agentic Skills Top 10](https://owasp.org/www-project-agentic-skills-top-10/) cites over a
thousand malicious skills found on a single registry in early 2026. RealityGate is built to
be checked, not just trusted. Every claim below is enforced by a test or a CI job:

| Promise | How it's enforced | Verify it yourself |
|---|---|---|
| **Zero dependencies, no install scripts** | `tests/trust.test.mjs` fails if `dependencies` or any `pre/post/install` script appears | `cat package.json` |
| **No network access, no telemetry** | Test fails if shipped code imports `http`/`https`/`net`/`tls`/`dns` or calls `fetch` | `grep -rn "fetch(" bin src hooks` |
| **Starts processes only where reviewed** | Test pins the exact list: `git` (file listing, diffs, commits) and `selftest --gate` running *your* gate command | `npx realitygate scan-skills .` → "spawns processes" |
| **Never reads `.env` contents** | Tests write a secret `.env` and assert it never appears in any output | `tests/trust.test.mjs` |
| **Hooks only run our own scripts** | Test asserts every plugin hook is `node ${CLAUDE_PLUGIN_ROOT}/hooks/guard-*.mjs`; the guards fail closed | `cat hooks/hooks.json` |
| **Skills are valid and clean** | CI runs the official **Agent Skills validator (`skills-ref`)**, **`claude plugin validate --strict`**, and RealityGate's own red-flag scan on every push | `npx realitygate scan-skills .` |
| **Releases built from public source** | npm releases are published from GitHub Actions with **npm provenance** (signed link to the exact commit and workflow) | npm package page → "Provenance" |
| **CI kept patched** | Dependabot for GitHub Actions | `.github/dependabot.yml` |

### Scan any skill or plugin before you install it

```bash
git clone --depth 1 https://github.com/someone/some-skill /tmp/some-skill   # don't install or run it
npx realitygate scan-skills /tmp/some-skill
```

It reads files only and never runs anything. Red flags:

| ID | Red flag | Severity |
|---|---|---|
| S-001 | Downloads and executes remote code (pipe to shell) | HIGH |
| S-002 | Encoded or obfuscated payloads that get decoded and executed | HIGH |
| S-003 | Hidden Unicode (zero-width, bidi override, tag characters) used for invisible instructions | HIGH |
| S-004 | Credential stores: SSH and cloud keys, browser data, keychain | HIGH |
| S-005 | Reading secret `.env` files | HIGH |
| S-006 | Known data-leak endpoints (chat-app webhooks, request catchers, tunnels, paste sites, raw TCP redirects) | HIGH |
| S-007 | Prompt injection / concealment instructions | HIGH |
| S-008 | Destructive system commands (wiping the home folder or disks, fork bombs) | HIGH |
| S-009 | Disabling the agent's permission prompts | HIGH |
| S-010…S-016 | Network calls in scripts, broad `allowed-tools`, binaries (complete PNG, JPEG, GIF and WebP images are listed instead), networked hooks, remote MCP servers, install scripts | MEDIUM |

It also prints **what the package would run**: every hook, MCP server, install script and file that
starts processes. **Publisher exclusions are always shown**, never silent: this repo excludes only
its tests and the scanner's own pattern file, with the reasons printed. Exit code 1 on HIGH
(`--strict`: also on MEDIUM). With the Claude Code plugin, just ask *"is this plugin safe to install?"*.

**Honest limit:** pattern scanning can't prove a skill is safe. Malicious instructions can be
phrased in endless ways ([Snyk explains why](https://snyk.io/blog/skill-scanner-false-security/)).
Treat a clean scan as "no known red flags", then read the `SKILL.md` files, check the publisher,
and pin a version or commit.

---

## 🔍 What it catches

16 built-in rules, all tested, all proven by `selftest` on every run.

| Rule | Catches | Why it matters |
|---|---|---|
| R-001 | `TODO` / `FIXME` / `XXX` / `HACK` in app code | Unfinished work presented as finished |
| R-002 | `throw new Error("not implemented")`, stubs | Code paths that don't exist |
| R-003 | `lorem ipsum`, "coming soon" | Placeholder product |
| R-004 | "for now", "in a real app", "in production you would…" | The agent admitting it simulated the work |
| R-005 | `John Doe`, `mockData`, `admin@example.com` outside tests | Fake data shipped to users |
| R-006 | `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` without `justified:` | Silenced type errors |
| R-007 | `eslint-disable` without `justified:` | Silenced lint |
| R-008 | `any` without `justified:` | Type safety switched off |
| R-009 | `console.log` in app code (scripts/bin exempt) | Debug leftovers, data leaks to logs |
| R-010 | Commented-out code *(warning)* | Dead code |
| R-011 | Hardcoded keys: AWS, Stripe live, GitHub, Slack, Google, OpenAI, Anthropic, private keys | Credential leaks |
| R-012 | `NEXT_PUBLIC_*SERVICE_ROLE*`, `VITE_*SECRET*` … | Secrets shipped to the browser |
| R-013 | `catch {}`, `.catch(() => [])`, `except: pass` | Failures hidden from users and you |
| R-014 | Imports of packages declared in no `package.json` (monorepo, tsconfig paths, aliases aware) | **Hallucinated packages**, missing deps, and slopsquatting risk |
| R-015 | Route handlers reading input with no zod/yup/valibot/joi/ajv validation | Injection and garbage data |
| R-016 | `modules/a` importing `modules/b/repo` | Architecture erosion |

Plus project checks in `audit`: a committed `.env` (detected by name, **never read**), no tests,
thin tests, **no negative-authorization tests** while routes exist, no real test script,
non-strict `tsconfig`, no CI, no lockfile.

**Your own rules.** Turn any "never break this" rule into a check:

```json
{
  "rules": [
    {
      "id": "HC-1",
      "label": "ledger is append-only",
      "pattern": "\\b(UPDATE|DELETE\\s+FROM)\\s+ledger_entries\\b",
      "flags": "i",
      "paths": ["src/**/*.ts"],
      "canary": "export const q = 'UPDATE ledger_entries SET amount = 0';"
    }
  ]
}
```

The `canary` is mandatory in spirit: `selftest` plants it and fails if your rule doesn't
fire. A rule that can't fail isn't protecting anything.

---

## 🏆 What makes it different

Most AI-coding repos are **prompts asking the agent to behave**. This one ships
**mechanisms that catch it when it doesn't**.

1. **A score anyone can run.** One command, any repo, no setup. Built for the people who
   can't read every line their agent wrote.
2. **Gates that prove they can fail.** `selftest` plants a violation for every rule and in
   your real gate. Building this kit, the self-test caught **two real bugs in its own rules**
   before release (see [FAILURES.md](FAILURES.md)). A gate that scans zero files is reported
   as broken, never as passing.
3. **Hallucinated-import detection.** Every bare import is checked against the package.json chain,
   workspaces, tsconfig paths and aliases, so invented packages fail the build.
4. **Enforcement, not instructions.** Claude Code hooks block secret access, destructive
   git, out-of-scope edits and applied-migration edits *before they happen*.
5. **Honest about uncertainty.** The audit says *heuristic*. `selftest` says *broken* rather than
   *passing*. The OS uses an `AWAITING_REVIEW` status instead of marking work done on trust.
6. **The whole lifecycle.** The OS covers idea → spec → architecture → release plan →
   test-first build → adversarial review → ship checklist → post-launch, with ceremony that
   scales (`quick` / `standard` / `full` tracks). It starts from your SRS, budgets for a
   solo founder, and never calls something "release ready" without evidence.
7. **Born from a real build.** Extracted from building a two-sided marketplace (mobile +
   web + double-entry ledger). Every rule names the failure it prevents.
8. **Zero dependencies, zero lock-in.** Pure Node standard library. MIT. Works alongside
   Spec Kit, OpenSpec, BMAD or Superpowers. It's the verification layer, not a rival.

---

## 📊 How it compares

These projects are excellent, and several of them inspired this one. The comparison is based
on each project's public README **as of October 2026**. Corrections are welcome.

| | **RealityGate** | [Spec Kit](https://github.com/github/spec-kit) | [OpenSpec](https://github.com/Fission-AI/OpenSpec) | [BMAD](https://github.com/bmad-code-org/BMAD-METHOD) | [Superpowers](https://github.com/obra/superpowers) | [Task Master](https://github.com/eyaltoledano/claude-task-master) | Kiro |
|---|---|---|---|---|---|---|---|
| Reality Score audit of any repo | ✅ | — | — | — | — | — | — |
| Fails the build on stubs / fake data | ✅ | — | — | — | — | — | — |
| Hallucinated-import detection | ✅ | — | — | — | — | — | — |
| Gates proven by planted canaries | ✅ | — | — | — | — | — | — |
| Proof Ledger (evidence per completed task) | ✅ | — | — | — | — | — | — |
| Packaged cross-model review | ✅ | — | — | — | ◐ same-model subagents | — | — |
| Hooks blocking secrets / destructive git / out-of-scope edits | ✅ | — | — | — | — | — | ◐ |
| Custom "never break" rules with mandatory canaries | ✅ | ◐ constitution | — | — | — | — | ◐ steering |
| Idea/docs → testable spec | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ | ✅ |
| Test-first enforced | ✅ | — | — | ◐ | ✅ | — | — |
| Independent clean-context review | ✅ | ◐ | — | ◐ | ✅ | — | — |
| Approval by decision type (schema/auth/money/deps/deploy) | ✅ | ◐ | — | ◐ | ◐ | — | ✅ phases |
| Release plan, ship checklist, post-launch | ✅ | — | — | ◐ | — | — | — |
| Scales ceremony to the change | ✅ tracks | ◐ | ✅ | ✅ | ◐ | ✅ | ◐ |
| Install | plugin · `npx` · Action, 0 deps | CLI | CLI | npx | plugin | CLI/MCP | IDE |

✅ core · ◐ partial/optional · — not described in the public README.

**Use them together:** plan with Spec Kit or OpenSpec, write code with Superpowers' TDD,
and put `realitygate check` + `selftest` in CI to make sure the result is real.

---

## 🚦 Put the gate in CI

The GitHub Action (see [Install](#-install--pick-one)) runs `audit`, `check` and `selftest` and
writes the report to the job summary. Inputs: `path`, `min-score`, `check`, `selftest`.
On any other CI:

```bash
npx realitygate check && npx realitygate selftest && npx realitygate audit --min-score 80
```

Commands exit non-zero on failure: `check` → 1 on any violation or empty scan;
`selftest` → 1 if any gate can't fail; `audit --min-score N` → 1 below N. Bad config → 2.

---

## 🛡️ Claude Code guardrails

```bash
npx github:usmanmanii/realitygate hooks install
```

This installs four tested `PreToolUse` hooks into `.claude/hooks/` and registers them in
`.claude/settings.json` (idempotent, keeps your other settings):

| Hook | Blocks |
|---|---|
| `guard-secrets` | Reading, writing, grepping or shelling out to `.env*` (example/sample/template allowed) |
| `guard-git` | `reset --hard`, force-push, `clean -f`, `checkout -- .`, `branch -D`, `--no-verify`, and **commits while the gate is red** |
| `guard-allowlist` | Edits outside the current task's `.agent/ALLOWLIST` during implementation |
| `guard-protected` | Edits to protected paths and **applied migrations** |

Every hook fails closed on unparsable input. Restart Claude Code after installing.

---

## 🧭 The Build OS: idea → shipped product

For new products, and for existing apps you want to finish, the CLI is the enforcement layer
and `BUILD-OS.md` is the process. It's built for a solo founder on a near-zero budget.

With the plugin, say *"start docs/SRS.pdf"* (or just *"build an app from my SRS"*). If you don't
give a path, `/realitygate:build` asks where your SRS is, then sets everything up step by step.
Without the plugin:

```bash
mkdir my-app && cd my-app && git init
npx github:usmanmanii/realitygate init --srs ../SRS.pdf   # kit, 6 subagents, config, your SRS in docs/input/
npx github:usmanmanii/realitygate doctor
```

1. Your SRS is the primary input. No SRS? Fill in `docs/IDEA.md` instead (13 short sections;
   "unsure" is a valid answer).
2. Drop any other documents (research, PDFs, notes, screenshots) into `docs/input/`.
3. Open Claude Code and paste the kickoff prompt from [START-HERE.md](START-HERE.md).
4. After that, you mostly type `continue`.

`init` installs six subagents in `.claude/agents/`: `planner`, `spec-critic`, `verifier`,
`security-auditor`, `drift-auditor` and `researcher`. Phase 0 writes `docs/COSTS.md`, a
monthly cost estimate with free-tier limits and a cost ceiling, and `ship` writes
`docs/RELEASE-READINESS.md`, which ends in exactly one state: `CODE COMPLETE`, `RELEASE READY`
or `LIVE DEPLOYED`.

```
 PHASE 0  Ingest · Probe · Profile · Scaffold   reads every doc, flags contradictions, checks your
                                                machine, pins a stack, installs hooks, proves the gate can fail
 PHASE 1  Spec (Socratic)                       5–8 questions at a time → SPEC.md in EARS form, R1 ≤ 12 features
 PHASE 2  Architecture                          modular monolith, per-table access rules, threat model, ADRs
 PHASE 3  Release plan                          R0 deploy day one → R1 MVP → R1.x → R2 by metric triggers
 PHASE 4  Backlog                               atomic tasks: ≤ 400 lines, one module, file allowlist
 PHASE 5  Build loop, per task                  LOAD → PLAN → TESTS (must fail) → IMPLEMENT → GATE →
                                                ADVERSARIAL REVIEW → PROVE → COMMIT → STOP
 PHASE 6  Ship                                  every checklist line proven by execution
 PHASE 7  Post-launch                           errors → funnel → feedback → triggers → replan
```

**Your vocabulary** (plain words, no slash): `start <SRS>` · `continue` / `resume` · `status` ·
`verify` · `next` · `blocked` · `replan` · `checkpoint` · `ship` / `prepare release` ·
`plan next release` · `explain` · `approve A-007` · `reject A-007 <why>`

**What only you decide:** you approve the spec; you approve schema, auth, money, data
deletion, dependencies and deploys, through plain-language approval cards with a
recommendation; you click through the app at every checkpoint; and you decide when it's done.

Full operator manual: [START-HERE.md](START-HERE.md). The constitution: [BUILD-OS.md](BUILD-OS.md).

---

## ⚙️ Configuration reference

`realitygate.config.json` at the project root. Every field is optional.

| Field | Meaning |
|---|---|
| `include` | Globs of app source to scan. Empty = every `.js/.ts/.jsx/.tsx/.mjs/.cjs/.py` outside tests. **Each glob must match ≥ 1 file** |
| `exclude` | Globs, or `{ "glob", "reason" }` |
| `mayBeEmpty` | `{ "glob": "written reason" }` for include targets that may legitimately be empty for now |
| `disable` | Rule IDs to turn off, e.g. `["R-009"]` |
| `rules` | Custom line rules: `id`, `label`, `pattern`, `flags`, `paths`, `severity`, `canary` |
| `fileRules` | Custom file rules: `trigger` present ⇒ `mustContain` required (e.g. money writes must mention the ledger) |
| `hooks.protectedPaths` | Globs the agent may not edit |
| `hooks.appliedMigrationsManifest` | JSON file listing applied migrations (keys or array); those files become immutable |

Always ignored: tests (`tests/`, `__tests__/`, `*.test.*`, `*.spec.*`), `node_modules`,
build output, `*.d.ts`, `*.config.*`, migrations, generated code, seed scripts, and the
contents of `.env*` files. Escape hatch for a single line: a `justified: <reason>` comment
(R-006/7/8).

---

## ❓ FAQ

**Is the Reality Score a guarantee my app is good?**
No. It's a fast, deterministic signal of the most common ways AI-built code fakes being done.
A low score means "look here first". A high score means none of those patterns were found,
not that the product is correct. That's what tests and the Build OS are for.

**Does it upload my code anywhere?** No. It runs locally, uses no network, has no telemetry,
and never reads `.env` contents. Tests enforce this; see [Trust & safety](#-trust--safety).

**Is RealityGate itself safe to install?** It has zero dependencies, no install scripts and no
network code, and it ships only hooks that run its own guard scripts. CI validates it with the official
Agent Skills validator, `claude plugin validate --strict` and its own red-flag scan, and npm releases
carry provenance. Check it yourself: `npx realitygate scan-skills .` in a clone of this repo.

**How do I check if a Claude Code skill or plugin is safe before installing it?**
Clone it without installing, then run `npx realitygate scan-skills <folder>`. It flags remote code
execution, obfuscation, hidden Unicode, credential and `.env` access, data-leak endpoints, prompt
injection and permission bypasses, and lists every hook and MCP server the package would run.

**Which languages?** JavaScript and TypeScript fully (including JSX/TSX, monorepos). Python
for placeholders, sample data, secrets and swallowed errors. More profiles are on the roadmap.

**Does it work with Codex, Gemini / Antigravity CLI, Cursor or GitHub Copilot?** Yes.
`npx realitygate agents install` adds portable Agent Skills (`.agents/skills/`) and rule files
(`AGENTS.md`, `GEMINI.md`, `.cursor/rules/realitygate.mdc`, `.github/copilot-instructions.md`), and
`npx realitygate hooks install --git` adds a pre-commit gate that blocks fake code from any agent.
Only the real-time action hooks are Claude Code-specific.

**How is this different from ESLint?** ESLint checks code style and correctness patterns.
RealityGate targets *AI-specific* failure modes: simulated implementations, invented packages,
fake data, secrets exposed to the client, missing negative-auth tests. It also proves its own
checks can fail. Use both.

**Is this spec-driven development?** The Build OS is, plus what comes after the spec. The CLI
is the verification layer you can add to any SDD tool.

**I already have an SRS. How do I start?** With the plugin, say *"start path/to/SRS.pdf"*. Without
it: `npx realitygate init --srs path/to/SRS.pdf`, then paste the kickoff prompt from
[START-HERE.md](START-HERE.md). Research and notes go in `docs/input/` next to it.

**Can I use it if I can't code?** That's the main audience. With the Claude Code plugin,
ask *"is my app production ready?"*, then *"fix the findings"*.

**How do I check if AI-generated code is production ready?**
Run `npx realitygate audit`. It scores the repo from 0 to 100 and lists every stub, placeholder,
invented package, leaked secret, unvalidated route and swallowed error, with a fix plan.
Guide: [docs/guides/check-ai-generated-code.md](docs/guides/check-ai-generated-code.md).

**How do I detect hallucinated npm packages?**
`realitygate check` fails on any import that no `package.json` in its path declares (monorepo,
tsconfig paths and aliases aware), which also protects against slopsquatting.
Guide: [docs/guides/detect-hallucinated-packages.md](docs/guides/detect-hallucinated-packages.md).

**How do I stop Claude Code from reading my .env file?**
Install the plugin (or run `realitygate hooks install`). `guard-secrets` blocks every Read, Grep,
Glob, Edit, Write and Bash call that touches `.env*`.
Guide: [docs/guides/claude-code-guardrails.md](docs/guides/claude-code-guardrails.md).

**How do I prove my AI agent really finished a task?**
`realitygate proof` checks each DONE task's journal for failing-test output, a green gate, an
APPROVED review, real execution output and an existing commit, then writes `PROOF.md` with a badge.

**How do I get an independent review of AI-written code?**
`realitygate review-pack <task-spec>` bundles reviewer instructions, the spec and the diff, so a
model from a different family can review it. Different families make different mistakes.

**What is a Reality Score?**
A 0–100 score across seven weighted categories: fake code (20), hallucinated imports (15),
security (25), error handling (10), type safety (10), tests (15), hygiene (5). Each category's
deduction is capped, so one noisy area can't hide the others.

---

## 🗺️ Roadmap

- [x] `audit` (Reality Score, fix plan, badge, Markdown/JSON) · `check` · `selftest --gate`
- [x] Claude Code guardrail hooks · `init` · `doctor` · `quick`/`standard`/`full` tracks · EARS criteria
- [x] Proof Ledger: `realitygate proof` → `PROOF.md` + "N/N tasks verified" badge
- [x] Packaged cross-model review: `realitygate review-pack`
- [x] Claude Code plugin (6 skills + hooks) · GitHub Action with job-summary report
- [x] Build OS from an SRS: `init --srs`, six subagents, cost estimate, release-readiness states, existing-code adoption
- [ ] PR comment with the score delta
- [ ] Read-only MCP server for any editor
- [ ] Change mode for existing repos; guides for Spec Kit / OpenSpec / Superpowers users
- [ ] More languages (Go, deeper Python)

## 📚 Guides

- [How to check if AI-generated code is production ready](docs/guides/check-ai-generated-code.md)
- [How to detect hallucinated npm packages (slopsquatting)](docs/guides/detect-hallucinated-packages.md)
- [Claude Code guardrails: block .env access, force-push and out-of-scope edits](docs/guides/claude-code-guardrails.md)
- [FAILURES.md: real ways AI-built code faked being done](FAILURES.md)

## 🤝 Contributing

The most valuable contribution is a **failure story**: "my agent did X and nothing caught
it." Each one becomes a rule, a canary and a [FAILURES.md](FAILURES.md) entry. See
[CONTRIBUTING.md](CONTRIBUTING.md). New rules must name the failure they prevent and ship
with a canary and tests.

## 🙏 Standing on the shoulders of

[GitHub Spec Kit](https://github.com/github/spec-kit) (constitution, spec → plan → tasks) ·
[Superpowers](https://github.com/obra/superpowers) (enforced TDD, fresh-subagent review) ·
[OpenSpec](https://github.com/Fission-AI/OpenSpec) (lightweight change specs) ·
[BMAD](https://github.com/bmad-code-org/BMAD-METHOD) (scale-adaptive tracks) ·
[GSD](https://github.com/open-gsd/gsd-core) (context-rot defence) ·
[Task Master](https://github.com/eyaltoledano/claude-task-master) (dependency-ordered tasks) ·
Kiro (EARS requirements).

## 📄 License

[MIT](LICENSE) © 2026 Muhammad Usman ([@usmanmanii](https://github.com/usmanmanii)). Use it, fork it, sell what you build with it.

---

<div align="center">

**If this caught something your agent shipped, ⭐ star the repo** so other vibe coders find it.

<sub>Keywords: vibe coding · AI code audit · Claude Code plugin · Claude Code skills · GitHub Action code quality · AI code review · Proof Ledger · AI code quality score · detect AI hallucinated packages ·
slopsquatting · prevent fake code from AI · spec-driven development · Claude Code workflow ·
Claude Code hooks · CLAUDE.md template · AGENTS.md · AI coding agents · agentic engineering ·
production-ready vibe coding · Cursor · Codex · Lovable · Bolt · v0 · MVP with AI · solo founder</sub>

</div>
