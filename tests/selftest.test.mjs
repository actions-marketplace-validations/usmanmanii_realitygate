import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { BUILTIN_RULE_IDS } from "../src/rules.mjs";
import { GATE_CANARY_NAME, runSelftest } from "../src/selftest.mjs";
import { CLI, cli, makeProject } from "./helpers.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));
const project = (files) => {
  const p = makeProject(files);
  cleanups.push(p.cleanup);
  return p.dir;
};

describe("selftest", () => {
  test("every built-in rule fires on its canary and clean code stays clean", () => {
    const r = runSelftest(project({ "src/a.ts": "export const a = 1;\n" }));
    assert.equal(r.ok, true, JSON.stringify(r.results.filter((x) => x.status === "FAIL")));
    for (const id of BUILTIN_RULE_IDS) {
      assert.ok(r.results.some((x) => x.name === `${id} canary` && x.status === "PASS"), id);
    }
    assert.ok(r.results.some((x) => x.name === "false-positive canary" && x.status === "PASS"));
  });

  test("a custom rule whose canary does not trigger it is reported as broken", () => {
    const dir = project({
      "src/a.ts": "export const a = 1;\n",
      "realitygate.config.json": { rules: [{ id: "HC-1", label: "no raw ledger updates", pattern: "UPDATE\\s+ledger", canary: "export const q = 'select 1';\n" }] },
    });
    const r = runSelftest(dir);
    assert.equal(r.ok, false);
    assert.equal(r.results.find((x) => x.name === "HC-1 canary").status, "FAIL");
  });

  test("a custom rule with a working canary and a path filter passes", () => {
    const dir = project({
      "src/a.ts": "export const a = 1;\n",
      "realitygate.config.json": {
        rules: [{ id: "HC-1", label: "no raw ledger updates", pattern: "UPDATE\\s+ledger", paths: ["src/modules/**/repo.ts"], canary: "export const q = 'UPDATE ledger SET x = 1';\n" }],
      },
    });
    const r = runSelftest(dir);
    assert.equal(r.results.find((x) => x.name === "HC-1 canary").status, "PASS");
  });

  test("a custom rule without a canary is a warning", () => {
    const dir = project({
      "src/a.ts": "export const a = 1;\n",
      "realitygate.config.json": { rules: [{ id: "HC-2", label: "x", pattern: "forbidden" }] },
    });
    assert.equal(runSelftest(dir).results.find((x) => x.name === "HC-2 canary").status, "WARN");
  });

  test("an include target matching nothing fails the selftest", () => {
    const dir = project({ "src/a.ts": "export const a = 1;\n", "realitygate.config.json": { include: ["server/**/*.ts"] } });
    const r = runSelftest(dir);
    assert.equal(r.ok, false);
    assert.ok(r.results.some((x) => x.status === "FAIL" && x.name.includes("server/**/*.ts")));
  });

  test("--gate: a gate that goes red on the planted canary passes", () => {
    const dir = project({ "src/a.ts": "export const a = 1;\n" });
    const gate = `"${process.execPath}" "${CLI}" check .`;
    const r = runSelftest(dir, { gate });
    assert.equal(r.results.find((x) => x.name === "gate canary").status, "PASS");
    assert.equal(existsSync(join(dir, "src", GATE_CANARY_NAME)), false, "canary removed");
  });

  test("--gate: a gate that stays green on the canary is reported broken", () => {
    const dir = project({ "src/a.ts": "export const a = 1;\n" });
    const gate = `"${process.execPath}" -e "process.exit(0)"`;
    const r = runSelftest(dir, { gate });
    const res = r.results.find((x) => x.name === "gate canary");
    assert.equal(res.status, "FAIL");
    assert.match(res.detail, /stayed GREEN/);
    assert.equal(existsSync(join(dir, "src", GATE_CANARY_NAME)), false, "canary removed");
  });

  test("--gate: the canary lands inside the include scope and its language", () => {
    const dir = project({ "lib/a.mjs": "export const a = 1;\n", "realitygate.config.json": { include: ["lib/**/*.mjs"] } });
    const gate = `"${process.execPath}" "${CLI}" check .`;
    const res = runSelftest(dir, { gate }).results.find((x) => x.name === "gate canary");
    assert.equal(res.status, "PASS", res.detail);
    assert.match(res.detail, /lib\/__realitygate_canary__\.mjs/);
    assert.equal(existsSync(join(dir, "lib", "__realitygate_canary__.mjs")), false, "canary removed");
  });

  test("CLI exit codes", () => {
    assert.equal(cli(["selftest", project({ "src/a.ts": "export const a = 1;\n" })]).code, 0);
    assert.equal(cli(["selftest", project({ "src/a.ts": "x", "realitygate.config.json": { include: ["nope/**"] } })]).code, 1);
  });
});
