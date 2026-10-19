import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { INSTRUCTIONS, SKILL_NAMES, installAgents, installGitHook, portableSkills, stripBlock } from "../src/agents.mjs";
import { runDoctor } from "../src/doctor.mjs";
import { CLI, KIT, cli, hasGit, makeProject, runHook } from "./helpers.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));
const project = (files, opts) => {
  const p = makeProject(files, opts);
  cleanups.push(p.cleanup);
  return p.dir;
};
const read = (dir, rel) => readFileSync(join(dir, rel), "utf8");

describe("portable Agent Skills (Codex, Antigravity CLI, other SKILL.md tools)", () => {
  test("agent-skills/ in the repo is in sync with skills/ (run scripts/sync-agent-skills.mjs)", () => {
    for (const s of portableSkills()) {
      assert.equal(read(KIT, `agent-skills/${s.dir}/SKILL.md`), s.content, s.dir);
    }
  });

  test("portable skills are self-contained: prefixed names match folders, no plugin paths", () => {
    for (const s of portableSkills()) {
      assert.match(s.content, new RegExp(`^name: ${s.dir}$`, "m"));
      assert.match(s.content, /^description: .{80,}/m);
      assert.ok(!s.content.includes("CLAUDE_PLUGIN_ROOT"), `${s.dir} still references the plugin root`);
      assert.ok(!/outside the plugin/i.test(s.content));
      assert.match(s.content, /npx --yes realitygate/);
    }
    assert.equal(portableSkills().length, SKILL_NAMES.length);
  });

  test("dropping the plugin-only fallback never drops a step or heading with it", () => {
    for (const name of SKILL_NAMES) {
      const source = read(KIT, `skills/${name}/SKILL.md`).replace(/\r\n/g, "\n");
      for (const paragraph of source.split(/\n{2,}/).filter((p) => /outside the plugin/i.test(p))) {
        assert.doesNotMatch(paragraph, /^\s*(?:\d+\.|[-*]|#{1,6}) /m, `${name}: put a blank line between the fallback and the next step:\n${paragraph}`);
      }
    }
  });
});

describe("agents install", () => {
  test("writes skills and instruction files for every assistant", () => {
    const dir = project({});
    const r = cli(["agents", "install", dir]);
    assert.equal(r.code, 0, r.stderr);
    for (const name of SKILL_NAMES) assert.ok(existsSync(join(dir, `.agents/skills/realitygate-${name}/SKILL.md`)), name);
    for (const rel of ["AGENTS.md", "GEMINI.md", ".github/copilot-instructions.md"]) {
      assert.match(read(dir, rel), /RealityGate: prove the code is real/, rel);
    }
    const cursor = read(dir, ".cursor/rules/realitygate.mdc");
    assert.match(cursor, /^---\ndescription: .+\nglobs:\nalwaysApply: true\n---/);
    assert.match(cursor, /npx --yes realitygate check/);
  });

  test("keeps existing AGENTS.md content and is idempotent", () => {
    const dir = project({ "AGENTS.md": "# My project rules\n\nUse pnpm.\n" });
    installAgents(dir);
    installAgents(dir);
    const text = read(dir, "AGENTS.md");
    assert.match(text, /^# My project rules\n\nUse pnpm\./);
    assert.equal(text.split("<!-- realitygate:start -->").length - 1, 1, "exactly one RealityGate block");
    assert.equal(stripBlock(text), "# My project rules\n\nUse pnpm.");
  });

  test("the shared instructions name the gate, the audit and the .env rule", () => {
    for (const phrase of ["realitygate check", "realitygate audit", ".env", "negative-authorization"]) {
      assert.ok(INSTRUCTIONS.includes(phrase), phrase);
    }
  });

  test("doctor ignores the RealityGate block when comparing AGENTS.md with CLAUDE.md", { skip: !hasGit() && "git not installed" }, () => {
    const dir = project(
      {
        ".gitignore": ".env*\n",
        "BUILD-OS.md": "x",
        "CLAUDE.md": "# rules\n",
        "AGENTS.md": "# rules\n",
        ".agent/STATE.json": { phase: "P", current_task: "T-1", current_step: "PLAN", tasks: {}, verify_status: "GREEN" },
      },
      { git: true },
    );
    installAgents(dir);
    assert.ok(!runDoctor(dir).results.some((r) => r.name === "AGENTS.md matches CLAUDE.md"));
  });
});

describe("git pre-commit gate (works with every agent)", { skip: !hasGit() && "git not installed" }, () => {
  const git = (dir, ...args) =>
    spawnSync("git", ["-c", "user.email=t@t.t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });

  // Points the hook's local-install branch at this checkout of the CLI.
  const shim = (dir) => {
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    const p = join(dir, "node_modules", ".bin", "realitygate");
    writeFileSync(p, `#!/bin/sh\nexec "${process.execPath.replace(/\\/g, "/")}" "${CLI.replace(/\\/g, "/")}" "$@"\n`, { mode: 0o755 });
  };

  test("a commit containing fake code is blocked; a clean commit goes through", () => {
    const dir = project({ ".gitignore": "node_modules/\n", "src/a.ts": "export const a = 1;\n" }, { git: true });
    shim(dir);
    installGitHook(dir);

    writeFileSync(join(dir, "src/b.ts"), "export const b = 1; // TODO real logic\n");
    git(dir, "add", ".");
    const bad = git(dir, "commit", "-m", "fake");
    assert.notEqual(bad.status, 0, `commit should be blocked:\n${bad.stdout}${bad.stderr}`);
    assert.match(bad.stdout + bad.stderr, /R-001/);

    writeFileSync(join(dir, "src/b.ts"), "export const b = 2;\n");
    git(dir, "add", ".");
    const good = git(dir, "commit", "-m", "real");
    assert.equal(good.status, 0, good.stdout + good.stderr);
  });

  test("never overwrites a pre-commit hook it didn't write", () => {
    const dir = project({}, { git: true });
    writeFileSync(join(dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho mine\n");
    assert.throws(() => installGitHook(dir), /not written by RealityGate/);
    assert.equal(read(dir, ".git/hooks/pre-commit"), "#!/bin/sh\necho mine\n");
  });

  test("honors core.hooksPath and is idempotent", () => {
    const dir = project({}, { git: true });
    git(dir, "config", "core.hooksPath", ".githooks");
    const first = installGitHook(dir);
    installGitHook(dir);
    assert.ok(first.replace(/\\/g, "/").endsWith(".githooks/pre-commit"));
    assert.match(read(dir, ".githooks/pre-commit"), /RealityGate pre-commit gate/);
  });

  test("outside a git repo it is a clear error (exit 2)", () => {
    assert.equal(cli(["hooks", "install", project({}), "--git"]).code, 2);
  });
});

describe("guard-secrets is tool-agnostic", () => {
  test("blocks other assistants' tool names and argument names", () => {
    assert.equal(runHook("guard-secrets.mjs", { tool_name: "run_shell_command", tool_input: { command: "cat .env" } }).code, 2);
    assert.equal(runHook("guard-secrets.mjs", { tool_name: "read_file", tool_input: { absolute_path: "/repo/.env.local" } }).code, 2);
    assert.equal(runHook("guard-secrets.mjs", { tool_name: "read_file", tool_input: { absolute_path: "/repo/src/env.ts" } }).code, 0);
  });
});
