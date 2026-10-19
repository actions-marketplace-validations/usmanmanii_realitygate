---
name: realitygate-build
description: Start or continue building a product with the RealityGate Build OS — a spec-driven, test-first operating system that takes a vibe coder from an idea and documents to a shipped MVP with adversarial review and human approval on risky decisions. Use when the user wants to start a new app or product from an idea, turn requirements or an SRS into a working app, plan an MVP with AI agents, or says continue, status, next, checkpoint or ship in a project that has BUILD-OS.md.
---

# RealityGate Build OS

## New project

1. Make sure the folder is a git repo (`git init` if not, after asking the user).
2. Copy the kit in (never overwrites existing files):

   ```bash
   npx --yes realitygate init
   npx --yes realitygate doctor
   ```

## Existing Build OS project (BUILD-OS.md and .agent/STATE.json exist)

Read `CLAUDE.md` and `.agent/STATE.json`, print one line (phase · release · task · step), and
follow `BUILD-OS.md` for the user's command:

| User says | Do |
|---|---|
| continue | Resume Phase 5 at exactly `current_step`. Never skip the gate, the review or the proof step |
| status | Read-only report: phase, task, counts by status, % done, pending approvals, blockers |
| verify | Run `bash scripts/verify.sh`, report each gate verbatim, change nothing |
| next | Refuse unless the current task is DONE (gate GREEN + review APPROVED + committed) |
| checkpoint | Full test suite, drift audit, `realitygate selftest --gate "bash scripts/verify.sh"`, `realitygate proof`, then a click-through list for the human |
| ship | Phase 6 checklist, every line proven by execution |

Never mark a task DONE without a green gate, an `[APPROVED]` review and a commit. For the review,
use the `realitygate-review` skill when a second model family is available.
