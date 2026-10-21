---
layout: default
title: How to detect hallucinated npm packages
description: Find undeclared and potentially invented npm package imports in AI-generated code.
---

# How to detect hallucinated npm packages (slopsquatting)

**Short answer:** `npx realitygate check` fails the build on any import of a package that no
`package.json` in the import's path declares (R-014), and on any declared dependency your
lockfile has no entry for (R-021). It reports the file, line and package name. A lockfile entry
shows the package exists, not that it's safe, so new dependencies still need a human look.

## What is a hallucinated package?

AI coding agents sometimes import packages that don't exist, or that exist under a slightly
different name. For example, `import { useMagicState } from "react-magic-state"`. Two things
can go wrong:

1. **The build breaks**, or worse, the code path silently never runs.
2. **Slopsquatting:** attackers register the names AI models commonly invent and publish
   malware under them. If someone then installs the invented name, they install the attacker's
   code.

## How RealityGate checks imports (rule R-014)

For every bare import (`import … from "x"`, `require("x")`, `import("x")`, `export … from "x"`),
it checks whether the package is declared in:

- the `dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies` of any
  `package.json` between the importing file and the repo root (monorepo-aware);
- the names of workspace packages in the repo;
- `tsconfig.json` / `jsconfig.json` `paths` aliases and `baseUrl` directories, and `package.json`
  `imports` (`#internal`);
- Node built-ins (`fs`, `node:fs`, …), relative paths, and common aliases (`@/`, `~/`).

Anything else is reported:

```
✗ components/Dashboard.tsx:2  R-014 import of a package not declared in any package.json
    import "react-magic-state"
```

## When the agent declares the package too (rule R-021)

R-014 trusts the manifest. If an agent invents a package *and* adds it to `package.json`,
R-014 has nothing to flag. R-021 closes that gap without going online. Every declared
dependency must have an entry in the lockfile (`package-lock.json`, `pnpm-lock.yaml`,
`yarn.lock`, `bun.lock`, `poetry.lock`, `uv.lock`, `pdm.lock`, `Pipfile.lock` or `go.sum`),
because only a real install from the registry writes one:

```
✗ package.json:12  R-021 declared dependency missing from the lockfile (never installed; may not exist)
    "react-magic-state" is declared but not in package-lock.json: never installed, so nothing shows it exists (install it, or the lockfile is stale)
```

With no lockfile, or only the binary `bun.lockb`, R-021 can't verify anything. It says so as a
warning instead of passing. Commit your lockfile.

**What a lockfile entry proves, and what it doesn't:** the name resolved on a registry when
someone installed it. That's all. It doesn't prove the package is the one you meant, or that it's
safe. A slopsquatted package installs fine and gets a lockfile entry like any other. Review new
dependencies before you install them, as described below.

## What to do with a finding

1. Check the registry: does `https://www.npmjs.com/package/<name>` exist, and is it the
   package you meant (author, downloads, repository)?
2. If it doesn't exist: remove the import and implement the function for real.
3. If it exists and is legitimate: add it explicitly (`npm install <name>`), and pin the version.
4. Never install a package just because the AI suggested it. Check it first.

## Add it to CI

```yaml
- uses: actions/checkout@v4
- uses: usmanmanii/realitygate@v0.3.0
```

Or anywhere with Node 20+: `npx realitygate check`.
