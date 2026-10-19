---
layout: default
title: Claude Code guardrails
description: Set up RealityGate hooks to block secret file access, destructive git commands, and out-of-scope edits.
---

# Claude Code guardrails: block .env access, force-push and out-of-scope edits

**Short answer:** install the RealityGate plugin (`/plugin marketplace add usmanmanii/realitygate`,
then `/plugin install realitygate@realitygate`) and run `npx realitygate init` in a project. Four
`PreToolUse` hooks then block the agent from touching `.env` files, running destructive git
commands, committing while the gate is red, editing files outside its task, or changing
migrations that were already applied.

## Why hooks instead of instructions

Rules in `CLAUDE.md` are instructions, and a long session can forget them. A `PreToolUse` hook runs before
every matching tool call. Exit code 2 blocks the call and shows the reason to the agent, so
the rule is enforced rather than merely remembered.

## The four guards

| Guard | Blocks | Active when |
|---|---|---|
| `guard-secrets` | Read/Edit/Write/Grep/Glob/Bash touching `.env`, `.env.local`, `.env*` (`.env.example` allowed) | project has `realitygate.config.json` (plugin) · always (project install) |
| `guard-git` | `git reset --hard`, force-push, `clean -f`, `checkout -- .`, `restore .`, `branch -D`, `stash drop`, `--no-verify`, and `git commit` while `.agent/STATE.json` says the gate isn't GREEN | same as above |
| `guard-allowlist` | Edits outside `.agent/ALLOWLIST` while a Build OS task is in TESTS/IMPLEMENT | an ALLOWLIST file exists |
| `guard-protected` | Edits to `hooks.protectedPaths` and to applied migrations listed in `hooks.appliedMigrationsManifest` | configured in `realitygate.config.json` |

All guards fail closed: if a guard can't parse its input, the call is blocked.

## Two ways to install

**Plugin (recommended):** hooks ship with the plugin. To avoid surprises, the secrets and git
guards activate only in projects that opted in by having `realitygate.config.json`.

```
/plugin marketplace add usmanmanii/realitygate
/plugin install realitygate@realitygate
```

**Per project, without the plugin:**

```bash
npx realitygate hooks install
```

This copies the guard scripts into `.claude/hooks/`, registers them in `.claude/settings.json`
(idempotent, other settings preserved), and adds `permissions.deny` for `Read(./.env)` and
`Read(./.env.*)`. Restart Claude Code afterwards.

## Protect applied migrations

```json
{
  "hooks": {
    "appliedMigrationsManifest": "supabase/migrations/checksums.json",
    "protectedPaths": ["docs/SPEC.md"]
  }
}
```

The manifest can be an object keyed by filename or an array of filenames. Listed migrations
become immutable to the agent; new migration files are still allowed.
