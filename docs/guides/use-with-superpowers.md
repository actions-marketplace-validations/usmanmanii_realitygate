---
layout: default
title: Use RealityGate with Superpowers
description: Add RealityGate's deterministic gate to Superpowers' TDD and review skills.
---

# Use RealityGate with Superpowers

**Short answer:** Superpowers improves how the agent works: brainstorming, plans, test-driven
development and code review all run as skills. RealityGate adds checks that don't depend on the
agent's judgment. `check` fails on stubs and invented packages even when a review missed them,
and `selftest` proves that the gate can fail at all. Install both plugins:

```text
/plugin install superpowers@claude-plugins-official
/plugin marketplace add usmanmanii/realitygate
/plugin install realitygate@realitygate
```

## Where they meet

| Superpowers skill | Add |
|---|---|
| `test-driven-development` | Nothing: keep red-green-refactor. RealityGate's `NO-TESTS` and `LOW-TEST-RATIO` checks are a backstop |
| `verification-before-completion` | `npx realitygate check` must exit 0. For anything users touch, also run `npx realitygate audit --exec`, which actually runs the tests and a clean-install boot |
| `requesting-code-review` | `npx realitygate review-pack <task-spec.md>`, to get a second opinion from a different model family |
| `finishing-a-development-branch` | `npx realitygate check --changed --base main` before merge |

## Setup

```bash
npx realitygate init
npx realitygate hooks install       # block .env access, force-push and commits while the gate is red
npx realitygate selftest --gate "npx realitygate check"
```

Add to `CLAUDE.md`:

> Verification before completion includes `npx realitygate check` (exit 0) and, for features,
> `npx realitygate audit --exec`. A check marked NOT RUN is not a pass.

## What each catches that the other doesn't

A review skill reads the diff, and a convincing diff can talk it into approving. A pattern rule
can't be talked into anything, but it can't judge design either. RealityGate catches the
mechanical fakes:

- `throw new Error("not implemented")`
- a package that doesn't exist
- `catch {}`
- an env var nobody documented
- an exported function nothing calls

Superpowers' reviews catch the rest.
