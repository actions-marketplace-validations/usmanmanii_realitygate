---
layout: default
title: Use RealityGate with OpenSpec
description: Run RealityGate's gate on each OpenSpec change before you archive it.
---

# Use RealityGate with OpenSpec

**Short answer:** OpenSpec gives each change its own folder, `openspec/changes/<id>/`, holding
`proposal.md`, spec deltas, `design.md` and `tasks.md`. Before you run `/opsx:archive`, run
`npx realitygate check --changed --base origin/main`. The gate checks only the files that
change touched. Old debt in an existing repo won't block you, and new code still has to pass.

## The loop

1. `/opsx:propose <name>`: OpenSpec writes the proposal, deltas, design and tasks.
2. `/opsx:apply`: the agent implements the tasks.
3. **`npx realitygate check --changed --base origin/main`**: fails in the changed files on
   stubs, `TODO`s, fake data, invented packages, swallowed errors, unvalidated routes, and env
   vars missing from `.env.example`. It warns on exports that nothing calls (built but never
   wired up).
4. **`npx realitygate audit --exec`** (optional, before a release): the static score, plus your
   test command and a clean-install boot, actually run. Anything that didn't run says NOT RUN.
5. `/opsx:archive`: only after steps 3 and 4 are green.

Each tool spells OpenSpec's slash commands its own way (for example `/opsx-propose` in Cursor and
GitHub Copilot). The RealityGate commands are the same everywhere.

## Setup

```bash
npx realitygate init
npx realitygate selftest --gate "npx realitygate check"
```

Add this to the agent instructions OpenSpec maintains (or to `AGENTS.md`):

> Before archiving a change, `npx realitygate check --changed --base origin/main` must exit 0.

## Why only the changed files

OpenSpec is built for existing codebases. A gate that fails on 300 old findings gets switched off
on day one. Change mode applies the same rules to new work. The include targets are still checked
against the whole project, so a misconfigured gate can't pass by scanning nothing.
