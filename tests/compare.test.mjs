import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { runAudit } from "../src/audit.mjs";
import { auditAtRef, auditDelta, changedFiles, deletedFiles } from "../src/compare.mjs";
import { runCheck } from "../src/check.mjs";
import { prCommentMarkdown, PR_COMMENT_MARKER } from "../src/report.mjs";
import { cli, hasGit, makeProject } from "./helpers.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));

const git = (dir, ...args) => execFileSync("git", ["-c", "user.email=t@t.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });

/** A repo whose first commit is clean and whose working tree then adds a stub. */
function repo() {
  const p = makeProject(
    {
      "package.json": { name: "app", scripts: { test: "node --test" } },
      "src/index.ts": 'import { total } from "./orders";\nexport const run = () => total([1]);\n',
      "src/orders.ts": "export const total = (xs: number[]) => xs.length;\n",
      "tests/orders.test.ts": "test('x', () => {});\n",
    },
    { git: true },
  );
  cleanups.push(p.cleanup);
  git(p.dir, "add", ".");
  git(p.dir, "commit", "-q", "-m", "base");
  return p.dir;
}

describe("score delta against a git ref", { skip: !hasGit() }, () => {
  test("auditAtRef scores the ref in a temporary worktree and removes it", () => {
    const dir = repo();
    writeFileSync(join(dir, "src/pay.ts"), 'export function pay(): never {\n  throw new Error("not implemented");\n}\n');
    const base = auditAtRef(dir, "HEAD");
    assert.ok(!base.findings.some((f) => f.file === "src/pay.ts"), "the base does not see the working tree");
    assert.equal(git(dir, "worktree", "list").trim().split("\n").length, 1);
  });

  test("the delta lists new and fixed findings, matched without line numbers", () => {
    const base = { score: 90, findings: [{ rule: "R-001", file: "a.ts", text: "// TODO a", line: 3 }, { rule: "R-002", file: "b.ts", text: "stub", line: 1 }] };
    const head = { score: 85, findings: [{ rule: "R-001", file: "a.ts", text: "// TODO a", line: 9 }, { rule: "R-013", file: "c.ts", text: "catch {}", line: 2, severity: "error" }] };
    const d = auditDelta(base, head, "main");
    assert.equal(d.change, -5);
    assert.deepEqual(d.newFindings.map((f) => f.rule), ["R-013"]);
    assert.deepEqual(d.fixedFindings.map((f) => f.rule), ["R-002"]);
  });

  test("audit --compare and --pr-comment produce the delta and a marked comment", () => {
    const dir = repo();
    writeFileSync(join(dir, "src/pay.ts"), 'export function pay(): never {\n  throw new Error("not implemented");\n}\n');
    const commentFile = join(dir, "..", `${Date.now()}-comment.md`);
    cleanups.push(() => rmSync(commentFile, { force: true }));
    const r = cli(["audit", dir, "--json", "--compare", "HEAD", `--pr-comment=${commentFile}`]);
    assert.equal(r.code, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.ok(json.delta.change < 0);
    assert.ok(json.delta.newFindings.some((f) => f.rule === "R-002"));
    const md = readFileSync(commentFile, "utf8");
    assert.ok(md.startsWith(PR_COMMENT_MARKER));
    assert.match(md, /▼ -\d+ vs `HEAD`/);
    assert.match(md, /R-002 stub implementation \| `src\/pay\.ts:2`/);
    assert.match(md, /Executed: 1 passed · 2 not run/);
  });

  test("an unknown ref is a usage error (exit 2)", () => {
    assert.equal(cli(["audit", repo(), "--compare", "no-such-ref"]).code, 2);
  });
});

describe("change mode: check --changed", { skip: !hasGit() }, () => {
  test("only uncommitted changes are gated; the old violation in committed code is not", () => {
    const dir = repo();
    writeFileSync(join(dir, "src/legacy.ts"), "export const a = 1; // TODO legacy\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "legacy debt");
    assert.equal(runCheck(dir).ok, false, "the full gate sees the legacy TODO");
    assert.equal(runCheck(dir, { onlyFiles: changedFiles(dir) }).ok, true, "nothing changed yet");

    writeFileSync(join(dir, "src/new.ts"), "export const b = 1; // FIXME new\n");
    const r = runCheck(dir, { onlyFiles: changedFiles(dir) });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors.map((e) => e.file), ["src/new.ts"]);
    assert.equal(r.filesScanned, 1);
  });

  test("--changed --base <ref> includes everything committed since the merge base", () => {
    const dir = repo();
    git(dir, "checkout", "-q", "-b", "feature");
    writeFileSync(join(dir, "src/feature.ts"), "export const c = 1; // TODO feature\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "feature");
    const main = git(dir, "rev-parse", "HEAD~1").trim();
    assert.deepEqual([...changedFiles(dir, main)], ["src/feature.ts"]);
    const out = cli(["check", dir, "--changed", "--base", main]);
    assert.equal(out.code, 1);
    assert.match(out.stdout, /change mode: checked 1 changed source file/);
  });

  test("removing a dependency from package.json rechecks R-014 in unchanged files that import it", () => {
    const dir = repo();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", dependencies: { zod: "3.23.8" } }));
    writeFileSync(join(dir, "src/schema.ts"), 'import { z } from "zod";\nexport const S = z.string();\n');
    writeFileSync(join(dir, "src/index.ts"), 'import { total } from "./orders";\nimport { S } from "./schema";\nexport const run = () => [total([1]), S];\n');
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "zod");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", dependencies: {} }));

    const r = runCheck(dir, { onlyFiles: changedFiles(dir) });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors.map((e) => `${e.rule} ${e.file}`), ["R-014 src/schema.ts"]);
    assert.deepEqual(r.widened, [{ because: ["package.json"], rules: ["R-014"], files: 3 }]);
    const out = cli(["check", dir, "--changed"]);
    assert.match(out.stdout, /package\.json changed, so R-014 also rechecked 3 unchanged file\(s\)/);
  });

  test("removing a var from .env.example rechecks R-017 in unchanged files that read it", () => {
    const dir = repo();
    writeFileSync(join(dir, ".env.example"), "API_KEY=example\n");
    writeFileSync(join(dir, "src/orders.ts"), "export const total = (xs: number[]) => xs.length + (process.env.API_KEY ? 0 : 0);\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "env");
    assert.equal(runCheck(dir, { onlyFiles: changedFiles(dir) }).ok, true);
    writeFileSync(join(dir, ".env.example"), "OTHER=1\n");

    const r = runCheck(dir, { onlyFiles: changedFiles(dir) });
    assert.deepEqual(r.errors.map((e) => `${e.rule} ${e.file}`), ["R-017 src/orders.ts"]);
    assert.deepEqual(r.widened.map((w) => w.rules), [["R-017"]]);
  });

  test("deleting the manifest or the env example warns that the check is now off, instead of passing quietly", () => {
    const dir = repo();
    writeFileSync(join(dir, ".env.example"), "API_KEY=example\n");
    writeFileSync(join(dir, "src/orders.ts"), "export const total = (xs: number[]) => xs.length + (process.env.API_KEY ? 0 : 0);\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "env");
    git(dir, "rm", "-q", ".env.example", "package.json");

    assert.deepEqual([...deletedFiles(dir)].sort(), [".env.example", "package.json"]);
    const r = runCheck(dir, { onlyFiles: changedFiles(dir), deleted: deletedFiles(dir) });
    assert.equal(r.ok, true, "a deletion alone is not a violation");
    assert.deepEqual(r.warnings.map((w) => `${w.rule} ${w.file}`), ["R-017 .env.example", "R-014 package.json"]);
    assert.match(r.warnings[0].text, /2 source file\(s\) under the root now have no env example/);
    assert.deepEqual(r.widened[0].because, [".env.example", "package.json"]);
    const out = cli(["check", dir, "--changed"]);
    assert.match(out.stdout, /check switched off: its source file was deleted/);
  });

  test("a renamed env example counts as deleted under its old name", () => {
    const dir = repo();
    writeFileSync(join(dir, ".env.example"), "API_KEY=example\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "env");
    git(dir, "mv", ".env.example", "env.txt");
    assert.deepEqual([...deletedFiles(dir)], [".env.example"]);
  });

  test("a change that touches no manifest scans only the changed files", () => {
    const dir = repo();
    writeFileSync(join(dir, "src/orders.ts"), "export const total = (xs: number[]) => xs.length * 1;\n");
    const r = runCheck(dir, { onlyFiles: changedFiles(dir) });
    assert.deepEqual([r.ok, r.filesScanned, r.widened], [true, 1, []]);
  });

  test("scope checks still apply to the whole project in change mode", () => {
    const dir = repo();
    writeFileSync(join(dir, "realitygate.config.json"), JSON.stringify({ include: ["lib/**/*.ts"] }));
    const r = runCheck(dir, { onlyFiles: changedFiles(dir) });
    assert.equal(r.ok, false);
    assert.match(r.scanErrors[0], /matched 0 files/);
  });

  test("the PR comment without a base still reports findings honestly", () => {
    const dir = repo();
    const result = runAudit(dir);
    result.checks = [{ id: "tests", name: "Test suite", status: "NOT RUN", detail: "" }];
    assert.match(prCommentMarkdown(result), /Executed: 1 not run/);
  });
});
