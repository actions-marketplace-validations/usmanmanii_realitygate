// Checks that actually run something, as opposed to the static analysis
// behind the Reality Score: the rule self-test, the project's test command,
// and a clean-install boot with only the documented env vars. Every result
// records the command and its exit code; a check that did not run says so.

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadConfig } from "./config.mjs";
import { documentedEnv } from "./env.mjs";
import { isSecretEnvFile, listFiles, readJson } from "./files.mjs";
import { runProof } from "./proof.mjs";
import { runSelftest } from "./selftest.mjs";

const NPM_DEFAULT_TEST = /no test specified/;
const TAIL_BYTES = 4000;
// The test run keeps more output: a monorepo prints one summary per package, and they are all counted.
const TEST_OUTPUT_BYTES = 256 * 1024;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const INSTALL_TIMEOUT_S = 600;
const TEST_TIMEOUT_S = 900;
// Without a ready pattern or probe, a server counts as booted once it has stayed up this long.
const SETTLE_S = 10;

// What any process needs to start on Linux, macOS and Windows. Nothing app-specific.
const BASE_ENV = new Set([
  "PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "SYSTEMDRIVE", "COMSPEC", "PATHEXT", "WINDIR",
  "TEMP", "TMP", "TMPDIR", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "LANG",
  "LC_ALL", "TERM", "SHELL", "USER", "LOGNAME", "CI",
]);

/** Runs a shell command, keeping the tail of its output. Never throws on a non-zero exit. */
export function runCommand(command, { cwd, env = process.env, timeoutS = TEST_TIMEOUT_S, keepBytes = TAIL_BYTES } = {}) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    let tail = "";
    let truncated = false;
    const child = spawn(command, { cwd, env, shell: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const keep = (chunk) => {
      tail += chunk;
      if (tail.length > keepBytes) {
        tail = tail.slice(-keepBytes);
        truncated = true;
      }
    };
    // Decode as UTF-8 per stream so a multi-byte character split across chunks (node:test's ℹ) survives.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutS * 1000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: null, durationMs: Date.now() - started, tail: e.message, timedOut: false, truncated: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: timedOut ? null : code, durationMs: Date.now() - started, tail, timedOut, truncated });
    });
  });
}

const sum = (text, re) => [...text.matchAll(re)].reduce((n, m) => n + Number(m[1]), 0);

/**
 * How many tests actually passed, read from the runner's own summary, because
 * an exit code of 0 is not proof: `node --test` with no test files, Jest/Vitest
 * with --passWithNoTests, and an all-skipped run under any runner all exit 0.
 * Formats (captured from real runs): node:test spec `ℹ pass N` and TAP
 * `# pass N`; Jest `Tests: N passed, M total`; Vitest `Tests  N passed (M)`;
 * Mocha `N passing`; pytest `N passed in 0.1s` / `no tests ran in`; go test
 * `ok  <pkg>` per package, `[no test files]` or `[no tests to run]` when empty.
 * Every summary found is added up. Returns null when none is recognised.
 */
export function testSummary(output) {
  const text = output.replace(ANSI, "").replace(/\r/g, "");
  let found = false;
  let passed = 0;
  let skipped = 0;
  let goPackages = 0;
  const add = (re, skipRe) => {
    if (!re.test(text)) return;
    found = true;
    passed += sum(text, new RegExp(re.source, "gm"));
    if (skipRe) skipped += sum(text, skipRe);
  };
  // node:test (spec and TAP reporters)
  add(/^(?:ℹ|#) pass (\d+)$/m, /^(?:ℹ|#) (?:skipped|todo) (\d+)$/gm);
  // Jest: "Tests:       1 failed, 2 passed, 1 skipped, 4 total"
  for (const [, line] of text.matchAll(/^Tests:\s+(.*\d+ total)$/gm)) {
    found = true;
    passed += sum(line, /(\d+) passed/g);
    skipped += sum(line, /(\d+) (?:skipped|todo)/g);
  }
  // Vitest: "      Tests  2 passed | 1 skipped (3)"
  for (const [, line] of text.matchAll(/^\s+Tests\s{2,}(.*)\(\d+\)$/gm)) {
    found = true;
    passed += sum(line, /(\d+) passed/g);
    skipped += sum(line, /(\d+) (?:skipped|todo)/g);
  }
  // Jest and Vitest with --passWithNoTests
  if (/^No tests? (?:files )?found, exiting with code 0$/m.test(text)) found = true;
  // Mocha
  add(/^\s*(\d+) passing \(/m, /^\s*(\d+) pending$/gm);
  // pytest: the last line, e.g. "==== 2 passed, 1 skipped in 0.04s ====" or "no tests ran in 0.01s"
  for (const [, line] of text.matchAll(/^=*\s*((?:\d+ \w+(?:, )?)+|no tests ran) in \d+(?:\.\d+)?s\b/gm)) {
    found = true;
    passed += sum(line, /(\d+) passed/g);
    skipped += sum(line, /(\d+) (?:skipped|xfailed|deselected)/g);
  }
  // go test: one line per package
  for (const [, rest] of text.matchAll(/^ok {2}\t\S+\t(.*)$/gm)) {
    found = true;
    if (!/\[no tests to run\]/.test(rest)) goPackages++;
  }
  if (/^\? {3}\t\S+\t\[no test files\]$/m.test(text)) found = true;
  if (!found) return null;
  return { passed, skipped, goPackages };
}

/** The verdict on a finished test run: exit code first, then whether any test really passed. */
export function testVerdict(r) {
  if (r.exitCode !== 0) return { status: "FAIL", detail: r.timedOut ? `timed out after ${TEST_TIMEOUT_S}s` : `exit ${r.exitCode}: ${lastLines(r.tail)}` };
  const s = testSummary(r.tail);
  if (!s) return { status: "PASS", detail: "exit 0 (no test summary recognised in the output, so the number of tests that ran is unknown)" };
  const skippedNote = s.skipped ? `, ${s.skipped} skipped` : "";
  if (s.passed > 0) return { status: "PASS", testsPassed: s.passed, detail: `${s.passed} test${s.passed === 1 ? "" : "s"} passed${skippedNote}${s.goPackages ? ` (+ ${s.goPackages} Go packages passed)` : ""}` };
  if (s.goPackages > 0) return { status: "PASS", detail: `${s.goPackages} Go package${s.goPackages === 1 ? "" : "s"} passed (go test prints no per-test count without -v)` };
  // A cut-off output can hide earlier summaries, so zero is only trusted when the whole output was kept.
  if (r.truncated) return { status: "PASS", detail: "exit 0 (output too long to count the tests that ran)" };
  return { status: "FAIL", testsPassed: 0, detail: `exit 0 but no tests ran${skippedNote}: a run without a passing test proves nothing` };
}

/** The project's test command: run.test from config, else a real `test` script in package.json. */
export function testCommand(root, config) {
  if (config.run.test) return config.run.test;
  const pkg = readJson(root, "package.json");
  return pkg?.scripts?.test && !NPM_DEFAULT_TEST.test(pkg.scripts.test) ? "npm test" : null;
}

export async function runTests(root, config) {
  const command = testCommand(root, config);
  const base = { id: "tests", name: "Test suite", kind: "executed" };
  if (!command) return { ...base, status: "NOT RUN", detail: "no test command: add a `test` script or set run.test in realitygate.config.json" };
  // node:test sets this var when RealityGate itself runs under it; inherited, it makes the project's `node --test` skip every file.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = await runCommand(command, { cwd: root, env, timeoutS: TEST_TIMEOUT_S, keepBytes: TEST_OUTPUT_BYTES });
  return { ...base, command, exitCode: r.exitCode, durationMs: r.durationMs, ...testVerdict(r) };
}

function installCommand(allFiles, pkg) {
  if (!pkg) return null;
  if (allFiles.includes("pnpm-lock.yaml")) return "pnpm install --frozen-lockfile";
  if (allFiles.includes("yarn.lock")) return "yarn install --frozen-lockfile";
  if (allFiles.includes("bun.lock") || allFiles.includes("bun.lockb")) return "bun install --frozen-lockfile";
  if (allFiles.includes("package-lock.json") || allFiles.includes("npm-shrinkwrap.json")) return "npm ci";
  return "npm install";
}

/**
 * The environment the app starts with: what any process needs, plus each
 * documented var, taken from the real environment when set (CI secrets) and
 * from the example file's placeholder otherwise. Nothing else gets through.
 */
export function bootEnv(documented, source = process.env) {
  const env = {};
  for (const key of Object.keys(source)) if (BASE_ENV.has(key.toUpperCase())) env[key] = source[key];
  const passed = [];
  for (const name of documented?.names ?? []) {
    if (source[name] !== undefined) env[name] = source[name];
    else if (documented.values.has(name)) env[name] = documented.values.get(name);
    else continue;
    passed.push(name);
  }
  return { env, passed: passed.sort() };
}

/**
 * Clean-install boot: copies the project without node_modules, build output or
 * secret env files, installs from the lockfile, then starts the app with only
 * the documented env vars. PASS when the ready pattern appears, the probe
 * command succeeds, or (with neither) the app stays up for SETTLE_S seconds.
 */
export async function runBoot(root, run) {
  const base = { id: "boot", name: "Clean install boots", kind: "executed" };
  const allFiles = listFiles(root);
  const pkg = readJson(root, "package.json");
  const start = run.start ?? (pkg?.scripts?.start ? "npm start" : null);
  if (!start) return { ...base, status: "NOT RUN", detail: "no start command: add a `start` script or set run.start in realitygate.config.json" };

  const dir = mkdtempSync(join(tmpdir(), "realitygate-boot-"));
  try {
    for (const f of allFiles) {
      if (isSecretEnvFile(f)) continue;
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      copyFileSync(join(root, f), join(dir, f));
    }
    const install = run.install ?? installCommand(allFiles, pkg);
    const steps = [];
    if (install) {
      const r = await runCommand(install, { cwd: dir, timeoutS: INSTALL_TIMEOUT_S });
      steps.push({ command: install, exitCode: r.exitCode });
      if (r.exitCode !== 0) {
        return { ...base, command: install, exitCode: r.exitCode, steps, status: "FAIL", detail: `install failed (${r.timedOut ? `timed out after ${INSTALL_TIMEOUT_S}s` : `exit ${r.exitCode}`}): ${lastLines(r.tail)}` };
      }
    }
    const { env, passed } = bootEnv(documentedEnv(root, allFiles).forFile("package.json"));
    const result = await startAndWait(start, { cwd: dir, env, ready: run.ready ? new RegExp(run.ready) : null, probe: run.probe, timeoutS: run.timeout });
    steps.push({ command: start, exitCode: result.exitCode });
    return { ...base, command: start, exitCode: result.exitCode, durationMs: result.durationMs, steps, envPassed: passed, status: result.ok ? "PASS" : "FAIL", detail: result.detail };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (e) {
      // A temp copy left behind is the OS's to clean up; it says nothing about whether the app booted.
      process.emitWarning(`could not remove the boot copy ${dir}: ${e.code ?? e.message}`);
    }
  }
}

function startAndWait(command, { cwd, env, ready, probe, timeoutS }) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const elapsed = () => Math.round((Date.now() - started) / 1000);
    let tail = "";
    let done = false;
    let readySeen = !ready;
    let probing = false;
    const child = spawn(command, { cwd, env, shell: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const timers = [];

    const finish = (ok, detail, exitCode = null) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      timers.forEach(clearInterval);
      const result = { ok, detail, exitCode, durationMs: Date.now() - started };
      if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return resolvePromise(result);
      // Windows holds the copy's files until the killed process is gone; wait for it (at most 5 s) so cleanup can delete them.
      const settle = setTimeout(() => resolvePromise(result), 5000);
      child.once("close", () => {
        clearTimeout(settle);
        resolvePromise(result);
      });
      killTree(child);
    };
    const tryProbe = async () => {
      if (probing || done) return;
      probing = true;
      const r = await runCommand(probe, { cwd, timeoutS: 30 });
      probing = false;
      if (r.exitCode === 0) finish(true, `probe \`${probe}\` passed after ${elapsed()}s`);
    };
    const onReady = () => {
      if (!probe) return finish(true, `ready pattern seen after ${elapsed()}s`);
      tryProbe();
      timers.push(setInterval(tryProbe, 1000));
    };
    const keep = (chunk) => {
      tail = (tail + chunk.toString()).slice(-TAIL_BYTES);
      if (!readySeen && ready.test(tail)) {
        readySeen = true;
        onReady();
      }
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (e) => finish(false, `could not start: ${e.message}`));
    child.on("close", (code) => {
      if (done) return;
      if (code === 0 && !ready && !probe) return finish(true, "ran to completion (exit 0)", 0);
      finish(false, `exited with ${code} after ${elapsed()}s${ready && !readySeen ? " before the ready pattern appeared" : ""}: ${lastLines(tail)}`, code);
    });

    if (ready) {
      // the ready pattern drives it
    } else if (probe) {
      onReady();
    } else {
      const settle = Math.min(SETTLE_S, timeoutS);
      timers.push(setTimeout(() => finish(true, `still running after ${settle}s with no crash`), settle * 1000));
    }
    timers.push(setTimeout(() => finish(false, `not ready after ${timeoutS}s${ready ? ` (waiting for /${ready.source}/)` : ""}: ${lastLines(tail)}`), timeoutS * 1000));
  });
}

function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function lastLines(text, n = 5) {
  return text.trim().split(/\r?\n/).slice(-n).join(" | ").slice(0, 600) || "(no output)";
}

/**
 * Everything the audit can report beyond static analysis. The rule self-test
 * always runs (it executes RealityGate's own rules on planted canaries, never
 * project code). Tests and the boot check run the project's commands, so they
 * need `exec`; otherwise they are listed as NOT RUN, never as a pass.
 */
export async function executedChecks(root, { configPath, exec = false, run = {} } = {}) {
  const config = loadConfig(root, configPath);
  for (const [k, v] of Object.entries(run)) if (v !== undefined) config.run[k] = v;
  const checks = [];

  const st = runSelftest(root, { configPath });
  const failed = st.results.filter((r) => r.status === "FAIL");
  checks.push({
    id: "selftest",
    name: "Rules fire on planted canaries",
    kind: "executed",
    command: "realitygate selftest",
    exitCode: st.ok ? 0 : 1,
    status: st.ok ? "PASS" : "FAIL",
    detail: st.ok ? `${st.results.filter((r) => r.status === "PASS").length} canary and scan checks passed` : failed.map((r) => `${r.name}: ${r.detail}`).join("; "),
  });

  if (exec) {
    checks.push(await runTests(root, config));
    checks.push(await runBoot(root, config.run));
  } else {
    const t = testCommand(root, config);
    checks.push({ id: "tests", name: "Test suite", kind: "executed", status: "NOT RUN", detail: t ? `test files were counted, not run: pass --exec to run \`${t}\`` : "no test command found" });
    checks.push({ id: "boot", name: "Clean install boots", kind: "executed", status: "NOT RUN", detail: "pass --exec to install from scratch and start the app with only the documented env vars" });
  }

  try {
    const p = runProof(root);
    checks.push({
      id: "proof",
      name: "Proof Ledger",
      kind: "recorded",
      status: p.verified === p.total ? "PASS" : "FAIL",
      detail: `${p.verified}/${p.total} DONE tasks have recorded evidence in their journals (read from the journal, not re-run)`,
    });
  } catch (e) {
    if (e?.code !== "NO_STATE") throw e;
  }
  return checks;
}
