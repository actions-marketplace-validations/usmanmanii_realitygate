---
layout: default
title: Prove your AI-written code is real
description: RealityGate scores AI-generated code and blocks stubs, fake data, invented packages, and leaked secrets.
---

# Your AI agent says it’s done. Prove it.

**RealityGate** is an open-source, zero-dependency CLI, Claude Code plugin, and GitHub Action that checks whether AI-generated code is real. It gives JavaScript, TypeScript, and Python projects a **Reality Score from 0 to 100** and provides a gate for common failures in AI-written code.

## Try the audit

Requires Node.js 20 or later. From the project you want to check:

```bash
npx github:usmanmanii/realitygate audit .
```

The audit reports a score, file and line references, and a fix plan. To fail CI when the gate finds a violation, run `npx github:usmanmanii/realitygate check`.

## What it checks

RealityGate has 16 built-in rules for unfinished implementations, placeholder copy, fake data, undeclared imports, leaked credentials, swallowed errors, unvalidated routes, and other common AI coding failures. `selftest` plants violations to prove the rules can fail. `scan-skills` checks skills and plugins for known security red flags before installation.

It runs locally, has no runtime dependencies, sends no telemetry, and never reads `.env` file contents. Pattern checks are heuristic: a clean result does not prove that an app is correct or secure.

## Use it with your assistant

- **Claude Code:** install the [RealityGate plugin](https://github.com/usmanmanii/realitygate#1-claude-code-plugin-easiest-everything-in-plain-english) for skills and guardrail hooks.
- **Codex, Gemini, Cursor, and Copilot:** run `npx github:usmanmanii/realitygate agents install` to add agent skills and project instructions.
- **Any CI:** run the CLI’s `check` command or use the [GitHub Action](https://github.com/usmanmanii/realitygate#3-github-action-every-push-and-pr).

## Build from your SRS

The Build OS takes a solo founder from an SRS or idea to a shipped MVP. With the Claude Code plugin, say *"start path/to/SRS.pdf"*; without it, run:

```bash
npx github:usmanmanii/realitygate init --srs path/to/SRS.pdf
```

`init` copies your SRS into `docs/input/` and installs six subagents: planner, spec critic, verifier, security auditor, drift auditor, and researcher. The process estimates monthly costs against free tiers, works with existing code, and reports one honest state at the end: code complete, release ready, or live deployed. See the [Build OS section of the README](https://github.com/usmanmanii/realitygate#-the-build-os-idea--shipped-product).

## Guides
{: #guides }

- [Check whether AI-generated code is production ready]({{ '/guides/check-ai-generated-code.html' | relative_url }})
- [Detect hallucinated npm packages]({{ '/guides/detect-hallucinated-packages.html' | relative_url }})
- [Set up Claude Code guardrails]({{ '/guides/claude-code-guardrails.html' | relative_url }})

See the [complete README](https://github.com/usmanmanii/realitygate/blob/main/README.md) for installation options, every rule, and the Build OS.
