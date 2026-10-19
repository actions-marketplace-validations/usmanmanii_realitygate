---
layout: default
title: How to check if AI-generated code is production ready
description: Use RealityGate to score AI-generated code and identify stubs, fake data, invented packages, and leaked secrets.
---

# How to check if AI-generated code is production ready

**Short answer:** run `npx realitygate audit` in the project folder. In about 30 seconds it gives
a Reality Score from 0 to 100, lists every stub, placeholder, invented package, leaked secret,
unvalidated route and swallowed error with its file and line, and prints a fix plan you can
paste into your AI agent.

## Why AI-generated code needs a different check

Code written by AI agents (Claude Code, Cursor, Codex, Lovable, Bolt, v0, Replit) usually
compiles and looks finished. The common failures are ones that linters and type checkers
don't look for:

| Failure | What it looks like | RealityGate rule |
|---|---|---|
| Simulated implementation | `// for now, pretend every payment succeeds` | R-004 |
| Stub | `throw new Error("Not implemented")` | R-002 |
| Placeholder marker | `// TODO: integrate Stripe properly` | R-001 |
| Fake data shipped to users | `const mockUsers = [{ name: "John Doe" }]` | R-005 |
| Hallucinated package | `import { sendReceipt } from "next-email-magic"` (not in package.json) | R-014 |
| Secret exposed to the browser | `process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` | R-012 |
| Unvalidated input | `const body = await request.json()` with no schema | R-015 |
| Swallowed error | `.catch(() => {})` | R-013 |
| No negative-authorization test | Routes exist, but no test proves user A can't read user B's data | project check |

## Step by step

1. **Audit:** `npx realitygate audit . --md` writes `REALITY-AUDIT.md` with every finding.
2. **Fix urgent items first:** rotate any exposed keys, then fix invented imports.
3. **Fix the rest in fix-plan order**, re-running `audit` after each group to watch the score rise.
   In Claude Code with the plugin installed, ask: *"fix my reality audit findings"*.
4. **Lock it in:** add `npx realitygate check` to CI (or the GitHub Action
   `usmanmanii/realitygate@v0.1.0` with `min-score: 80`) so fake code can't come back.
5. **Prove the gate works:** `npx realitygate selftest` plants a violation for every rule and
   fails if any rule stays silent.

## What the score means and doesn't mean

- **A (90–100):** none of the common fake-code, security and testing patterns were found.
- **F (< 60):** treat the app as a prototype until the fix plan is done.
- The score is heuristic and deterministic. It flags what to look at; it doesn't prove the
  product is correct. Tests and the Build OS cover correctness.

## FAQ

**Is it safe to run on private code?** Yes. It runs locally with no network calls, no telemetry,
and it never reads `.env` file contents.

**Which languages?** JavaScript and TypeScript fully, including monorepos. Python for placeholders,
fake data, secrets and swallowed errors.

**How is this different from ESLint or SonarQube?** Those check general code quality.
RealityGate targets the specific ways AI agents fake being done, and it proves its own
checks can fail.
