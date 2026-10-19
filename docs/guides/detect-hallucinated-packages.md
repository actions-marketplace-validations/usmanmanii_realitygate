---
layout: default
title: How to detect hallucinated npm packages
description: Find undeclared and potentially invented npm package imports in AI-generated code.
---

# How to detect hallucinated npm packages (slopsquatting)

**Short answer:** `npx realitygate check` fails the build on any import of a package that no
`package.json` in the import's path declares. It reports the file, line and package name, so an
invented package never reaches `main`.

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

## What to do with a finding

1. Check the registry: does `https://www.npmjs.com/package/<name>` exist, and is it the
   package you meant (author, downloads, repository)?
2. If it doesn't exist: remove the import and implement the function for real.
3. If it exists and is legitimate: add it explicitly (`npm install <name>`), and pin the version.
4. Never install a package just because the AI suggested it. Check it first.

## Add it to CI

```yaml
- uses: actions/checkout@v4
- uses: usmanmanii/realitygate@v0.2.1
```

Or anywhere with Node 20+: `npx realitygate check`.
