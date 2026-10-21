---
layout: default
title: Use RealityGate with Spec Kit
description: Plan with GitHub Spec Kit, then prove what got built is real with RealityGate's gate, self-test and score.
---

# Use RealityGate with GitHub Spec Kit

**Short answer:** keep Spec Kit for the plan (constitution → spec → plan → tasks) and add
RealityGate as the proof layer:

- run `npx realitygate check` after every task
- run `npx realitygate selftest --gate "<your gate>"` once
- run `npx realitygate audit --exec` before you call a feature done

Spec Kit says what to build. RealityGate checks that what got built isn't a stub.

## Where each tool stops

| Step | Spec Kit | RealityGate |
|---|---|---|
| Principles | `/speckit-constitution` | Your gate rules in `realitygate.config.json`, proven by `selftest` |
| What to build | `/speckit-specify` → `specs/<feature>/spec.md` | Nothing: read the spec, don't rewrite it |
| How | `/speckit-plan` → `plan.md`, `/speckit-tasks` → `tasks.md` | Nothing |
| Build | `/speckit-implement` | `check` after each task. It catches stubs, `TODO`s, fake data, invented packages, swallowed errors, unvalidated routes and undocumented env vars |
| Done? | `tasks.md` checkboxes | `audit --exec`: the static score, plus your test command and a clean-install boot, actually run |

Spec Kit's README spells its commands with a hyphen (`/speckit-specify`), and some agents show
them with a dot (`/speckit.specify`). Its README also lists extensions, hooks and workflows, which
you can use to run the gate automatically.

## Setup (5 minutes)

```bash
npx realitygate init          # config + Build OS files (the Build OS files are optional here)
npx realitygate hooks install # Claude Code: block .env access, force-push, commits on a red gate
npx realitygate selftest --gate "npx realitygate check"   # prove the gate can go red
```

Add one line to your constitution (or to `CLAUDE.md` / `AGENTS.md`):

> A task is not done until `npx realitygate check` exits 0. Never weaken a test or add an
> exclusion to make it pass.

## Existing repos

If the repo already has debt, gate only what each change touches:

```bash
npx realitygate check --changed --base origin/main
```

This runs the same rules, with the same project context, but only on files changed since the
merge base. Run `npx realitygate audit` once to see the debt you inherited.

## In CI

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0
- run: npx --yes realitygate check --changed --base "origin/$GITHUB_BASE_REF"
```

Or use the RealityGate GitHub Action with `comment: true`. It posts the score, and the change
since the base branch, on each pull request.
