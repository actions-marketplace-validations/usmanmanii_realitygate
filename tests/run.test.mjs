import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { bootEnv, executedChecks, runBoot, testSummary, testVerdict } from "../src/run.mjs";
import { cli, makeProject } from "./helpers.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));
const project = (files) => {
  const p = makeProject(files);
  cleanups.push(p.cleanup);
  return p.dir;
};

const NO_INSTALL = { install: "node -e 0", start: null, ready: null, probe: null, timeout: 20 };
// A server that needs API_KEY, refuses to start if a .env file came along, and stays up.
const SERVER =
  'const fs = require("node:fs");\n' +
  'if (fs.existsSync(".env")) { console.error("found .env"); process.exit(4); }\n' +
  'if (!process.env.API_KEY) { console.error("API_KEY missing"); process.exit(1); }\n' +
  'setTimeout(() => { fs.writeFileSync("ready.txt", "1"); console.log("listening on 3000"); }, 200);\n' +
  "setInterval(() => {}, 1000);\n";
const APP = { "package.json": { name: "app", scripts: { start: "node server.js" } }, "server.js": SERVER };

describe("boot environment", () => {
  test("passes only the base vars and the documented ones, preferring real values", () => {
    const documented = { names: new Set(["API_KEY", "DATABASE_URL", "OPTIONAL_DSN"]), values: new Map([["API_KEY", "example"], ["DATABASE_URL", "postgres://localhost/app"]]) };
    const { env, passed } = bootEnv(documented, { PATH: "/bin", API_KEY: "real", STRIPE_SECRET: "leak", HOME: "/h" });
    assert.deepEqual(env, { PATH: "/bin", HOME: "/h", API_KEY: "real", DATABASE_URL: "postgres://localhost/app" });
    assert.deepEqual(passed, ["API_KEY", "DATABASE_URL"]);
  });
});

describe("realitygate boot", () => {
  test("a documented app starts: ready pattern seen", async () => {
    const dir = project({ ...APP, ".env.example": "API_KEY=example-key\n" });
    const r = await runBoot(dir, { ...NO_INSTALL, ready: "listening" });
    assert.equal(r.status, "PASS", r.detail);
    assert.deepEqual(r.envPassed, ["API_KEY"]);
    assert.deepEqual(r.steps.map((s) => s.command), ["node -e 0", "npm start"]);
  });

  test("an env var set on this machine but not documented does not reach the app", async () => {
    const dir = project({ ...APP, ".env.example": "PORT=3000\n" });
    process.env.API_KEY = "set-on-the-dev-machine";
    try {
      const r = await runBoot(dir, { ...NO_INSTALL, ready: "listening" });
      assert.equal(r.status, "FAIL");
      assert.match(r.detail, /exited with 1.*API_KEY missing/);
    } finally {
      delete process.env.API_KEY;
    }
  });

  test("secret env files are not copied into the clean install", async () => {
    const dir = project({ ...APP, ".env.example": "API_KEY=k\n", ".env": "API_KEY=real\n" });
    const r = await runBoot(dir, { ...NO_INSTALL, ready: "listening" });
    // The server exits 4 if it finds a .env file next to it.
    assert.equal(r.status, "PASS", r.detail);
  });

  test("a probe command decides readiness", async () => {
    const dir = project({ ...APP, ".env.example": "API_KEY=k\n" });
    const r = await runBoot(dir, { ...NO_INSTALL, probe: 'node -e "process.exit(require(\'fs\').existsSync(\'ready.txt\') ? 0 : 1)"' });
    assert.equal(r.status, "PASS", r.detail);
    assert.match(r.detail, /probe/);
  });

  test("with no ready pattern or probe, staying up counts as booted", async () => {
    const dir = project({ ...APP, ".env.example": "API_KEY=k\n" });
    const r = await runBoot(dir, { ...NO_INSTALL, timeout: 2 });
    assert.equal(r.status, "PASS", r.detail);
    assert.match(r.detail, /still running after 2s/);
  });

  test("never becoming ready is a failure", async () => {
    const dir = project({ ...APP, ".env.example": "API_KEY=k\n" });
    const r = await runBoot(dir, { ...NO_INSTALL, ready: "will-never-print", timeout: 2 });
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /not ready after 2s/);
  });

  test("a failing install fails before the app starts", async () => {
    const dir = project({ ...APP });
    const r = await runBoot(dir, { ...NO_INSTALL, install: 'node -e "process.exit(7)"' });
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /install failed \(exit 7\)/);
  });

  test("no start command is NOT RUN, never a pass", async () => {
    const r = await runBoot(project({ "src/a.ts": "export const a = 1;\n" }), NO_INSTALL);
    assert.equal(r.status, "NOT RUN");
    assert.equal(cli(["boot", project({ "src/a.ts": "export const a = 1;\n" })]).code, 2);
  });
});

// Summaries captured from real runs: node 24, Jest 30, Vitest 5, Mocha 12, pytest. go test's
// lines follow the format strings in cmd/go/internal/test/test.go.
const OUT = {
  nodeNone: "ℹ tests 0\nℹ suites 0\nℹ pass 0\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 20.3\n",
  nodeTapNone: "TAP version 13\n1..0\n# tests 0\n# suites 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n",
  nodePass: "ℹ tests 3\nℹ suites 0\nℹ pass 2\nℹ fail 0\nℹ cancelled 0\nℹ skipped 1\nℹ todo 0\n",
  jestPass: "Test Suites: 1 passed, 1 total\nTests:       2 passed, 2 total\nSnapshots:   0 total\nTime:        0.753 s\n",
  jestSkip: "Test Suites: 1 skipped, 0 of 1 total\nTests:       1 skipped, 1 total\nSnapshots:   0 total\n",
  jestNone: "No tests found, exiting with code 0\n",
  vitestPass: " \x1b[32mTest Files\x1b[39m  1 passed (1)\n      Tests  2 passed (2)\n   Start at  14:14:11\n",
  vitestSkip: " Test Files  1 skipped (1)\n      Tests  1 skipped (1)\n",
  vitestNone: "No test files found, exiting with code 0\n",
  mochaPass: "  ✔ a\n  ✔ b\n\n  2 passing (2ms)\n",
  mochaSkip: "  - a\n\n  0 passing (2ms)\n  1 pending\n",
  pytestPass: "p\\test_a.py ..      [100%]\r\n\r\n============================== 2 passed in 0.04s ==============================\r\n",
  pytestSkip: "============================= 1 skipped in 0.05s ==============================\n",
  pytestQuiet: "..   [100%]\n2 passed, 1 skipped in 0.01s\n",
  goPass: "ok  \texample.com/app/api\t0.012s\n?   \texample.com/app/cmd\t[no test files]\n",
  goNone: "?   \texample.com/app\t[no test files]\nok  \texample.com/app/lib\t0.003s [no tests to run]\n",
};

describe("test run verdict", () => {
  const verdict = (tail, extra = {}) => testVerdict({ exitCode: 0, tail, truncated: false, ...extra });

  test("a run where no test passed is a FAIL even though it exited 0", () => {
    for (const name of ["nodeNone", "nodeTapNone", "jestSkip", "jestNone", "vitestSkip", "vitestNone", "mochaSkip", "pytestSkip", "goNone"]) {
      const v = verdict(OUT[name]);
      assert.equal(v.status, "FAIL", name);
      assert.match(v.detail, /no tests ran/, name);
    }
    assert.match(verdict(OUT.jestSkip).detail, /1 skipped/);
  });

  test("passing runs report how many tests passed", () => {
    assert.deepEqual(testSummary(OUT.nodePass), { passed: 2, skipped: 1, goPackages: 0 });
    for (const [name, n] of [["jestPass", 2], ["vitestPass", 2], ["mochaPass", 2], ["pytestPass", 2], ["pytestQuiet", 2]]) {
      const v = verdict(OUT[name]);
      assert.equal(v.status, "PASS", name);
      assert.equal(v.testsPassed, n, name);
    }
    assert.equal(verdict(OUT.nodePass).detail, "2 tests passed, 1 skipped");
    assert.match(verdict(OUT.goPass).detail, /^1 Go package passed/);
  });

  test("summaries from several packages are added up", () => {
    assert.equal(testSummary(OUT.nodeNone + OUT.jestPass + OUT.nodePass).passed, 4);
  });

  test("a non-zero exit is a FAIL whatever the summary says", () => {
    assert.equal(verdict(OUT.jestPass, { exitCode: 1 }).status, "FAIL");
  });

  test("an unrecognised summary passes on exit 0 but says the count is unknown", () => {
    const v = verdict("all good\n");
    assert.equal(v.status, "PASS");
    assert.match(v.detail, /number of tests that ran is unknown/);
  });

  test("zero is not trusted when the output was cut off", () => {
    assert.equal(verdict(OUT.goNone, { truncated: true }).status, "PASS");
  });
});

describe("executed vs inferred in the audit", () => {
  const base = { "package.json": { name: "x", scripts: { test: 'node -e "process.exit(3)"' } }, "src/a.ts": "export const a = 1;\n" };

  test("without --exec, tests and boot are NOT RUN and the self-test still runs", async () => {
    const checks = await executedChecks(project(base));
    assert.deepEqual(checks.map((ch) => [ch.id, ch.status]), [["selftest", "PASS"], ["tests", "NOT RUN"], ["boot", "NOT RUN"]]);
    assert.match(checks[1].detail, /counted, not run/);
  });

  test("with exec, the test command really runs and its exit code is recorded", async () => {
    const checks = await executedChecks(project(base), { exec: true });
    const t = checks.find((ch) => ch.id === "tests");
    assert.deepEqual([t.status, t.command, t.exitCode], ["FAIL", "npm test", 3]);
  });

  test("with exec, `node --test` finding no tests is a FAIL, not a pass", async () => {
    const dir = project({ "package.json": { name: "x", scripts: { test: "node --test" } }, "src/a.js": "export const a = 1;\n" });
    const t = (await executedChecks(dir, { exec: true })).find((ch) => ch.id === "tests");
    assert.deepEqual([t.status, t.exitCode, t.testsPassed], ["FAIL", 0, 0]);
    assert.match(t.detail, /no tests ran/);
  });

  test("with exec, a real passing test is counted", async () => {
    const dir = project({
      "package.json": { name: "x", scripts: { test: "node --test" } },
      "a.test.mjs": 'import { test } from "node:test";\nimport assert from "node:assert";\ntest("adds", () => assert.equal(1 + 1, 2));\n',
    });
    const t = (await executedChecks(dir, { exec: true })).find((ch) => ch.id === "tests");
    assert.deepEqual([t.status, t.testsPassed, t.detail], ["PASS", 1, "1 test passed"]);
  });

  test("audit JSON labels categories as static and lists executed checks; --exec fails on a failed check", () => {
    const dir = project(base);
    const plain = cli(["audit", dir, "--json"]);
    assert.equal(plain.code, 0);
    const r = JSON.parse(plain.stdout);
    assert.equal(r.checks.find((ch) => ch.id === "tests").status, "NOT RUN");
    const md = cli(["audit", dir, "--exec"]);
    assert.equal(md.code, 1);
    assert.match(md.stdout, /Executed \(1 passed · 1 failed · 1 not run\)/);
  });
});
