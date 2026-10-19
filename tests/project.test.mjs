import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { runDoctor } from "../src/doctor.mjs";
import { HOOKS, commandFor, installHooks } from "../src/hooks-install.mjs";
import { AGENT_NAMES, KIT_AGENTS, KIT_FILES, runInit } from "../src/init.mjs";
import { KIT, cli, hasGit, makeProject } from "./helpers.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));
const project = (files, opts) => {
  const p = makeProject(files, opts);
  cleanups.push(p.cleanup);
  return p.dir;
};

describe("init", () => {
  test("copies the kit and a starter config", () => {
    const dir = project({});
    runInit(dir);
    for (const f of [...KIT_FILES, ...KIT_AGENTS.map((a) => a.to), "realitygate.config.json"]) assert.ok(existsSync(join(dir, f)), f);
  });
  test("every Build OS subagent has frontmatter Claude Code accepts (name matches file, description, tools)", () => {
    for (const name of AGENT_NAMES) {
      const text = readFileSync(join(KIT, "templates/agents", `${name}.md`), "utf8").replace(/\r\n/g, "\n");
      const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1];
      assert.ok(front, `${name}: frontmatter`);
      assert.equal(/^name: (.+)$/m.exec(front)?.[1], name);
      assert.ok((/^description: (.+)$/m.exec(front)?.[1] ?? "").length > 40, `${name}: description`);
      assert.match(front, /^tools: [A-Za-z]+(, [A-Za-z]+)*$/m, `${name}: tools`);
    }
  });
  test("--srs copies the requirements document into docs/input/ and never overwrites it", () => {
    const source = project({ "My SRS.md": "# SRS v1\n" });
    const srs = join(source, "My SRS.md");
    const dir = project({});
    const first = runInit(dir, { srs });
    assert.equal(first.find((r) => r.file === "docs/input/My SRS.md").action, "created");
    assert.equal(readFileSync(join(dir, "docs/input/My SRS.md"), "utf8"), "# SRS v1\n");
    writeFileSync(srs, "# SRS v2\n");
    const second = runInit(dir, { srs });
    assert.equal(second.find((r) => r.file === "docs/input/My SRS.md").action, "skipped (exists)");
    assert.equal(readFileSync(join(dir, "docs/input/My SRS.md"), "utf8"), "# SRS v1\n");
  });
  test("--srs refuses a missing file and secrets files, before writing anything", () => {
    const dir = project({ ".env.local": "TOKEN=do-not-copy\n" });
    assert.throws(() => runInit(dir, { srs: join(dir, "missing.pdf") }), /no such file/);
    assert.throws(() => runInit(dir, { srs: join(dir, ".env.local") }), /secrets never go in docs\/input/);
    assert.equal(existsSync(join(dir, "BUILD-OS.md")), false);
    const r = cli(["init", dir, "--srs"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--srs needs a file path/);
  });
  test("never overwrites without --force", () => {
    const dir = project({ "docs/IDEA.md": "# my real idea\n" });
    const results = runInit(dir);
    assert.equal(readFileSync(join(dir, "docs/IDEA.md"), "utf8"), "# my real idea\n");
    assert.equal(results.find((r) => r.file === "docs/IDEA.md").action, "skipped (exists)");
    runInit(dir, { force: true });
    assert.notEqual(readFileSync(join(dir, "docs/IDEA.md"), "utf8"), "# my real idea\n");
  });
});

describe("hooks install", () => {
  test("copies scripts and registers PreToolUse hooks, idempotently, preserving other settings", () => {
    const dir = project({ ".claude/settings.json": { model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] } } });
    const first = installHooks(dir);
    assert.equal(first.added.length, HOOKS.length);
    const second = installHooks(dir);
    assert.equal(second.added.length, 0);

    const settings = JSON.parse(readFileSync(join(dir, ".claude/settings.json"), "utf8"));
    assert.equal(settings.model, "opus");
    assert.equal(settings.hooks.Stop.length, 1);
    assert.equal(settings.hooks.PreToolUse.length, HOOKS.length);
    for (const h of HOOKS) {
      assert.ok(existsSync(join(dir, ".claude/hooks", h.script)));
      const group = settings.hooks.PreToolUse.find((g) => g.hooks[0].command === commandFor(h.script));
      assert.equal(group.matcher, h.matcher);
      assert.equal(group.hooks[0].type, "command");
    }
    assert.ok(settings.permissions.deny.includes("Read(./.env)"));
  });
  test("refuses to clobber an invalid settings.json", () => {
    const dir = project({});
    installHooks(dir);
    writeFileSync(join(dir, ".claude/settings.json"), "{ broken");
    assert.throws(() => installHooks(dir), /not valid JSON/);
  });
});

describe("doctor", () => {
  test("fails outside a kit project", () => {
    const r = runDoctor(project({}));
    assert.equal(r.ok, false);
    assert.equal(r.results.find((x) => x.name === "BUILD-OS.md").status, "FAIL");
  });

  test("freshly initialised git project: passes with Phase 0 pending", { skip: !hasGit() && "git not installed" }, () => {
    const dir = project({ ".gitignore": ".env*\n" }, { git: true });
    runInit(dir);
    const r = runDoctor(dir);
    assert.equal(r.ok, true, JSON.stringify(r.results.filter((x) => x.status === "FAIL")));
    assert.equal(r.results.find((x) => x.name === "Phase 0").status, "WARN");
    assert.equal(r.results.find((x) => x.name === "docs/IDEA.md").status, "WARN", "template not filled in");
    assert.equal(r.results.find((x) => x.name === "requirements input").status, "WARN", "no SRS and no idea yet");
    writeFileSync(join(dir, "docs/input/SRS.md"), "# SRS\n");
    const withSrs = runDoctor(dir).results;
    const input = withSrs.find((x) => x.name === "requirements input");
    assert.equal(input.status, "PASS");
    assert.match(input.detail, /1 document/);
    assert.equal(withSrs.find((x) => x.name === "docs/IDEA.md").status, "PASS", "IDEA.md is optional once an SRS is in docs/input/");
  });

  test("after Phase 0: validates STATE.json, agents, gate and hooks", { skip: !hasGit() && "git not installed" }, () => {
    const dir = project(
      {
        ".gitignore": ".env*\n",
        ".agent/STATE.json": { phase: "PHASE_5_BUILD", current_task: "T-001", current_step: "PLAN", tasks: {}, verify_status: "GREEN" },
        "CLAUDE.md": "# rules\n",
        "AGENTS.md": "# rules\n",
        "PROJECT-PROFILE.md": "# profile\n",
        ".claude/agents/verifier.md": "x",
        ".claude/agents/planner.md": "x",
        "scripts/verify.sh": "pnpm -r --if-present lint\nnpx realitygate check\n",
      },
      { git: true },
    );
    runInit(dir);
    const r = runDoctor(dir);
    const status = (name) => r.results.find((x) => x.name === name)?.status;
    assert.equal(status(".agent/STATE.json"), "PASS");
    assert.equal(status("gate has no --if-present"), "WARN");
    assert.equal(status("gate runs the reality check"), "PASS");
    assert.equal(status("gate runs the self-test"), "WARN");
    assert.equal(status("guardrail hooks"), "WARN");
    installHooks(dir);
    assert.equal(runDoctor(dir).results.find((x) => x.name === "guardrail hooks").status, "PASS");
  });
});

describe("cli", () => {
  test("--version and --help", () => {
    assert.match(cli(["--version"]).stdout, /^\d+\.\d+\.\d+/);
    const help = cli(["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /realitygate audit/);
  });
  test("unknown command exits 1", () => {
    assert.equal(cli(["frobnicate"]).code, 1);
  });
  test("no command prints help and exits 1", () => {
    assert.equal(cli([]).code, 1);
  });
});
