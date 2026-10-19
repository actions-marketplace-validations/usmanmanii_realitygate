# Contributing

Thanks for helping make AI-built software real.

## The most valuable contribution: a failure story

Open an issue titled `Failure: <one line>`:
1. What the agent produced (minimal snippet).
2. Why existing checks didn't catch it.
3. A suggested rule or mechanism.

## Ground rules for code

- **Zero runtime dependencies.** Node ≥ 20 standard library only.
- **Every rule needs:** an ID, a label, a canary in `src/selftest.mjs`, positive *and*
  negative tests in `tests/rules.test.mjs`, a row in the README rule table, and a
  `FAILURES.md` entry naming the failure it prevents.
- **False positives are bugs.** A noisy gate gets switched off (see F-004). Add a test
  for the legitimate code your rule must not flag.
- **Hooks fail closed** and are tested by running them as real processes (`tests/hooks.test.mjs`).
- **Never read `.env` contents**, anywhere, for any reason.

## Before opening a PR

```bash
npm run verify     # tests + dogfood check + selftest
node bin/realitygate.mjs selftest --gate "node bin/realitygate.mjs check"
```

All green, or explain why not.

## Comparison corrections

If the README misrepresents your project, open an issue. We'll fix it within 48 hours and credit you.
