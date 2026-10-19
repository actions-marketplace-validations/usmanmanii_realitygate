## RealityGate: prove the code is real

This project uses [RealityGate](https://github.com/usmanmanii/realitygate) to keep AI-written code real.

- Before saying a task is done, run `npx --yes realitygate check` and fix every violation for real.
  Never add excludes, disable rules or weaken tests to make it pass.
- Never ship stubs, `TODO`/`FIXME`, "for now" simulations, placeholder copy, or fake/sample data
  outside tests. If something can't be implemented for real, stop and say what is missing.
- Never import a package that isn't declared in package.json. Check the registry first, and ask
  before adding a dependency.
- Validate every route's input with a schema, never swallow errors (`catch {}`), and add a
  negative-authorization test (user A cannot access user B's data) for every route that touches data.
- Never read, print or edit `.env` files. Ask the human for variable names, never values.
- To see overall health: `npx --yes realitygate audit` (Reality Score 0–100 with a fix plan).
- If `BUILD-OS.md` exists, follow it: plan → failing tests → implement → gate → independent review → commit.
