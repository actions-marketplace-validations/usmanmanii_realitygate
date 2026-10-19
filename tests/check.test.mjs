import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { runCheck } from "../src/check.mjs";
import { ConfigError, loadConfig } from "../src/config.mjs";
import { cli, FAKE_AWS_KEY, hasGit, makeProject } from "./helpers.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));
const project = (files, opts) => {
  const p = makeProject(files, opts);
  cleanups.push(p.cleanup);
  return p.dir;
};

describe("check", () => {
  test("clean project passes", () => {
    const dir = project({ "src/a.ts": "export const a = 1;\n" });
    const r = runCheck(dir);
    assert.equal(r.ok, true);
    assert.equal(r.filesScanned, 1);
  });

  test("a violation fails the gate (CLI exit 1)", () => {
    const dir = project({ "src/a.ts": "export const a = 1; // TODO\n" });
    const r = cli(["check", dir]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /R-001/);
  });

  test("an include target matching zero files FAILS (no silent empty scan)", () => {
    const dir = project({ "src/a.ts": "export const a = 1;\n", "realitygate.config.json": { include: ["src/**/*.ts", "apps/api/**/*.ts"] } });
    const r = runCheck(dir);
    assert.equal(r.ok, false);
    assert.match(r.scanErrors[0], /apps\/api\/\*\*\/\*\.ts.*0 files/);
  });

  test("mayBeEmpty with a written reason allows an empty target", () => {
    const dir = project({
      "src/a.ts": "export const a = 1;\n",
      "realitygate.config.json": { include: ["src/**/*.ts", "apps/api/**/*.ts"], mayBeEmpty: { "apps/api/**/*.ts": "API is built in wave 2" } },
    });
    assert.equal(runCheck(dir).ok, true);
  });

  test("mayBeEmpty without a reason is a config error", () => {
    const dir = project({ "realitygate.config.json": { mayBeEmpty: { "x/**": "" } } });
    assert.throws(() => loadConfig(dir), ConfigError);
  });

  test("warnings do not fail the gate", () => {
    const dir = project({ "src/a.ts": "// const legacy = old();\nexport const a = 1;\n" });
    const r = runCheck(dir);
    assert.equal(r.ok, true);
    assert.equal(r.warnings[0].rule, "R-010");
  });

  test("secrets in config files are caught too", () => {
    const dir = project({ "src/a.ts": "export const a = 1;\n", "config/keys.json": { aws: FAKE_AWS_KEY } });
    const r = runCheck(dir);
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].rule, "R-011");
  });

  test("exclude entries may carry a reason", () => {
    const dir = project({
      "src/a.ts": "export const a = 1; // TODO\n",
      "realitygate.config.json": { exclude: [{ glob: "src/a.ts", reason: "generated" }], include: [], mayBeEmpty: {} },
      "src/b.ts": "export const b = 1;\n",
    });
    assert.equal(runCheck(dir).ok, true);
  });

  test("invalid config regex is reported, CLI exit 2", () => {
    const dir = project({ "src/a.ts": "export const a = 1;\n", "realitygate.config.json": { rules: [{ id: "HC-1", label: "x", pattern: "(" }] } });
    const r = cli(["check", dir]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not a valid regular expression/);
  });

  test("untracked (not yet committed) files are scanned in a git repo", { skip: !hasGit() && "git not installed" }, () => {
    const dir = project({ "src/new-feature.ts": "export const f = 1; // FIXME\n", ".gitignore": "ignored/\n", "ignored/x.ts": "// TODO\n" }, { git: true });
    const r = runCheck(dir);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors.map((e) => e.file), ["src/new-feature.ts"], "untracked file scanned, git-ignored file not");
  });

  test("never reads .env contents", () => {
    const dir = project({ "src/a.ts": "export const a = 1;\n", ".env": `KEY=${FAKE_AWS_KEY}\n`, ".env.local": "// TODO\n" });
    const r = runCheck(dir);
    assert.equal(r.ok, true);
  });
});
