import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { join } from "node:path";
import { makeProject, runHook } from "./helpers.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));
const project = (files) => {
  const p = makeProject(files);
  cleanups.push(p.cleanup);
  return p.dir;
};

const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const edit = (file_path) => ({ tool_name: "Edit", tool_input: { file_path, old_string: "a", new_string: "b" } });

describe("guard-secrets", () => {
  const blocked = [
    { tool_name: "Read", tool_input: { file_path: "/repo/.env" } },
    { tool_name: "Read", tool_input: { file_path: "C:\\repo\\apps\\web\\.env.local" } },
    { tool_name: "Write", tool_input: { file_path: "/repo/.env.production", content: "x" } },
    { tool_name: "Grep", tool_input: { pattern: "KEY", path: "/repo/.env" } },
    { tool_name: "Glob", tool_input: { pattern: "**/.env*" } },
    bash("cat .env"),
    bash("grep SECRET apps/web/.env.local"),
    bash("source .env && npm start"),
    bash('node -e "require(\'dotenv\').config({path:\'.env\'})"'),
  ];
  const allowed = [
    { tool_name: "Read", tool_input: { file_path: "/repo/.env.example" } },
    { tool_name: "Read", tool_input: { file_path: "/repo/src/env.ts" } },
    { tool_name: "Read", tool_input: { file_path: "/repo/.environment-notes.md" } },
    bash("cp .env.example .env.example.bak"),
    bash("npm test"),
    bash("cat src/environment.ts"),
  ];
  for (const input of blocked) test(`blocks ${JSON.stringify(input.tool_input)}`, () => assert.equal(runHook("guard-secrets.mjs", input).code, 2));
  for (const input of allowed) test(`allows ${JSON.stringify(input.tool_input)}`, () => assert.equal(runHook("guard-secrets.mjs", input).code, 0));
  test("fails closed on garbage input", () => assert.equal(runHook("guard-secrets.mjs", null, { raw: "not json" }).code, 2));
});

describe("guard-git", () => {
  const blocked = [
    "git reset --hard HEAD~1",
    "git push --force origin main",
    "git push -f",
    "git push origin +main",
    "git push --force-with-lease",
    "git clean -fd",
    "git checkout -- .",
    "git restore .",
    "git branch -D feature",
    "git commit --no-verify -m x",
    "git stash drop",
    "git push origin --delete feature",
  ];
  const allowed = ["git status", "git diff --stat", "git push origin feature", "git checkout -b feature", "git restore src/a.ts", "git log --oneline"];
  for (const cmd of blocked) test(`blocks: ${cmd}`, () => assert.equal(runHook("guard-git.mjs", bash(cmd)).code, 2));
  for (const cmd of allowed) test(`allows: ${cmd}`, () => assert.equal(runHook("guard-git.mjs", bash(cmd)).code, 0));

  test("blocks commit while verify_status is not GREEN", () => {
    const dir = project({ ".agent/STATE.json": { verify_status: "RED" } });
    const r = runHook("guard-git.mjs", bash('git commit -m "feat: x"'), { projectDir: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /RED/);
  });
  test("allows commit when GREEN", () => {
    const dir = project({ ".agent/STATE.json": { verify_status: "GREEN" } });
    assert.equal(runHook("guard-git.mjs", bash('git commit -m "feat: x"'), { projectDir: dir }).code, 0);
  });
  test("allows commit when the project has no STATE.json", () => {
    assert.equal(runHook("guard-git.mjs", bash('git commit -m "x"'), { projectDir: project({}) }).code, 0);
  });
});

describe("plugin mode (--plugin): guards apply only in opted-in projects", () => {
  test("no realitygate.config.json: secrets and git guards stand down", () => {
    const dir = project({});
    assert.equal(runHook("guard-secrets.mjs", bash("cat .env"), { projectDir: dir, args: ["--plugin"] }).code, 0);
    assert.equal(runHook("guard-git.mjs", bash("git push --force"), { projectDir: dir, args: ["--plugin"] }).code, 0);
  });
  test("with realitygate.config.json: they block", () => {
    const dir = project({ "realitygate.config.json": {} });
    assert.equal(runHook("guard-secrets.mjs", bash("cat .env"), { projectDir: dir, args: ["--plugin"] }).code, 2);
    assert.equal(runHook("guard-git.mjs", bash("git push --force"), { projectDir: dir, args: ["--plugin"] }).code, 2);
  });
  test("still fails closed on garbage input", () => {
    assert.equal(runHook("guard-secrets.mjs", null, { raw: "nope", projectDir: project({}), args: ["--plugin"] }).code, 2);
  });
});

describe("guard-allowlist", () => {
  const files = {
    ".agent/ALLOWLIST": "# T-014\nsrc/modules/invites/*.ts\ntests/integration/invites.test.ts\n",
    ".agent/STATE.json": { current_step: "IMPLEMENT", verify_status: "RED" },
  };
  test("allows allowlisted files", () => {
    const dir = project(files);
    assert.equal(runHook("guard-allowlist.mjs", edit(join(dir, "src/modules/invites/service.ts")), { projectDir: dir }).code, 0);
    assert.equal(runHook("guard-allowlist.mjs", edit("tests/integration/invites.test.ts"), { projectDir: dir }).code, 0);
  });
  test("blocks files outside the allowlist", () => {
    const dir = project(files);
    const r = runHook("guard-allowlist.mjs", edit(join(dir, "src/modules/billing/service.ts")), { projectDir: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /src\/modules\/billing\/service\.ts/);
  });
  test(".agent/** is always editable", () => {
    const dir = project(files);
    assert.equal(runHook("guard-allowlist.mjs", edit(join(dir, ".agent/journal/T-014.md")), { projectDir: dir }).code, 0);
  });
  test("inactive outside TESTS/IMPLEMENT", () => {
    const dir = project({ ...files, ".agent/STATE.json": { current_step: "PLAN" } });
    assert.equal(runHook("guard-allowlist.mjs", edit(join(dir, "README.md")), { projectDir: dir }).code, 0);
  });
  test("inactive without an ALLOWLIST file", () => {
    const dir = project({});
    assert.equal(runHook("guard-allowlist.mjs", edit(join(dir, "anything.ts")), { projectDir: dir }).code, 0);
  });
});

describe("guard-protected", () => {
  const files = {
    "realitygate.config.json": { hooks: { protectedPaths: ["docs/SPEC.md"], appliedMigrationsManifest: "supabase/migrations/checksums.json" } },
    "supabase/migrations/checksums.json": { "0000_baseline.sql": "abc", "0001_ledger.sql": "def" },
  };
  test("blocks an applied migration", () => {
    const dir = project(files);
    const r = runHook("guard-protected.mjs", edit(join(dir, "supabase/migrations/0001_ledger.sql")), { projectDir: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /APPLIED migration/);
  });
  test("allows a new migration", () => {
    const dir = project(files);
    assert.equal(runHook("guard-protected.mjs", edit(join(dir, "supabase/migrations/0002_tasks.sql")), { projectDir: dir }).code, 0);
  });
  test("blocks protectedPaths and the manifest itself", () => {
    const dir = project(files);
    assert.equal(runHook("guard-protected.mjs", edit(join(dir, "docs/SPEC.md")), { projectDir: dir }).code, 2);
    assert.equal(runHook("guard-protected.mjs", edit(join(dir, "supabase/migrations/checksums.json")), { projectDir: dir }).code, 2);
  });
  test("array-style manifest is supported", () => {
    const dir = project({ ...files, "supabase/migrations/checksums.json": ["0000_baseline.sql"] });
    assert.equal(runHook("guard-protected.mjs", edit(join(dir, "supabase/migrations/0000_baseline.sql")), { projectDir: dir }).code, 2);
  });
  test("no config means no protection and no error", () => {
    const dir = project({});
    assert.equal(runHook("guard-protected.mjs", edit(join(dir, "x.sql")), { projectDir: dir }).code, 0);
  });
  test("fails closed on a broken config", () => {
    const dir = project({ "realitygate.config.json": "{ nope" });
    assert.equal(runHook("guard-protected.mjs", edit(join(dir, "x.sql")), { projectDir: dir }).code, 2);
  });
});
