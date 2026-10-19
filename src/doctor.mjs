import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONFIG_FILE, ConfigError, loadConfig } from "./config.mjs";
import { isGitRepo } from "./files.mjs";
import { stripBlock } from "./agents.mjs";
import { HOOKS, commandFor } from "./hooks-install.mjs";

const REQUIRED_STATE_KEYS = ["phase", "current_task", "current_step", "tasks", "verify_status"];
const COMMANDS = ["continue", "status", "verify", "next", "blocked", "replan", "checkpoint", "ship", "explain"];

/** Is the kit wired correctly in this project? Read-only. */
export function runDoctor(rootArg) {
  const root = resolve(rootArg);
  const results = [];
  const add = (name, status, detail) => results.push({ name, status, detail });
  const has = (rel) => existsSync(join(root, rel));
  const read = (rel) => readFileSync(join(root, rel), "utf8");

  const major = Number(process.versions.node.split(".")[0]);
  add("node >= 20", major >= 20 ? "PASS" : "FAIL", `running ${process.versions.node}`);
  add("git repository", isGitRepo(root) ? "PASS" : "FAIL", isGitRepo(root) ? "ok" : "run `git init` first");
  add("BUILD-OS.md", has("BUILD-OS.md") ? "PASS" : "FAIL", has("BUILD-OS.md") ? "present" : "run `npx realitygate init`");

  const inputs = has("docs/input") ? readdirSync(join(root, "docs/input")).filter((f) => f !== "README.md") : [];
  const ideaFilled = has("docs/IDEA.md") && !read("docs/IDEA.md").includes("<product name>");
  if (!has("docs/IDEA.md")) add("docs/IDEA.md", "WARN", "missing — run `npx realitygate init`");
  else if (ideaFilled) add("docs/IDEA.md", "PASS", "filled in");
  else if (inputs.length) add("docs/IDEA.md", "PASS", "template (optional: the documents in docs/input/ are the input)");
  else add("docs/IDEA.md", "WARN", "still the template — fill it in before Phase 0");

  add(
    "requirements input",
    inputs.length || ideaFilled ? "PASS" : "WARN",
    inputs.length
      ? `${inputs.length} document(s) in docs/input/`
      : ideaFilled
        ? "docs/IDEA.md (no documents in docs/input/)"
        : "no SRS or idea yet — put your SRS in docs/input/ (`realitygate init --srs <file>`) or fill in docs/IDEA.md",
  );

  if (has(CONFIG_FILE)) {
    try {
      loadConfig(root);
      add(CONFIG_FILE, "PASS", "valid");
    } catch (e) {
      add(CONFIG_FILE, "FAIL", e instanceof ConfigError ? e.message : String(e));
    }
  }

  const gitignore = has(".gitignore") ? read(".gitignore") : "";
  add(".env is git-ignored", /^\s*\.env/m.test(gitignore) ? "PASS" : "WARN", /^\s*\.env/m.test(gitignore) ? "ok" : "add `.env*` and `!.env.example` to .gitignore");

  if (!has(".agent/STATE.json")) {
    add("Phase 0", "WARN", "not run yet — paste the kickoff prompt from START-HERE.md into Claude Code");
    return summarize(results);
  }

  let state = null;
  try {
    state = JSON.parse(read(".agent/STATE.json"));
  } catch (e) {
    add(".agent/STATE.json", "FAIL", `invalid JSON: ${e.message}`);
  }
  if (state) {
    const missing = REQUIRED_STATE_KEYS.filter((k) => !(k in state));
    add(".agent/STATE.json", missing.length ? "FAIL" : "PASS", missing.length ? `missing keys: ${missing.join(", ")}` : `phase ${state.phase} · task ${state.current_task} · step ${state.current_step}`);
  }

  for (const rel of ["CLAUDE.md", "AGENTS.md", "PROJECT-PROFILE.md", ".claude/agents/verifier.md", ".claude/agents/planner.md"]) {
    add(rel, has(rel) ? "PASS" : "FAIL", has(rel) ? "present" : "missing — Phase 0 should have created it");
  }
  if (has("CLAUDE.md") && has("AGENTS.md") && stripBlock(read("CLAUDE.md")) !== stripBlock(read("AGENTS.md"))) {
    add("AGENTS.md matches CLAUDE.md", "WARN", "they differ — other agents will follow different rules");
  }
  const missingCommands = COMMANDS.filter((cmd) => !has(`.claude/commands/${cmd}.md`) && !has(`.claude/skills/${cmd}/SKILL.md`));
  add("slash commands", missingCommands.length ? "WARN" : "PASS", missingCommands.length ? `missing: ${missingCommands.join(", ")}` : "all present");

  if (has("scripts/verify.sh")) {
    const verify = read("scripts/verify.sh");
    add("scripts/verify.sh", "PASS", "present");
    add("gate has no --if-present", /--if-present/.test(verify) ? "WARN" : "PASS", /--if-present/.test(verify) ? "a missing script would look like a pass" : "ok");
    add("gate runs the reality check", /realitygate(?:\.mjs)?\s+check|reality-check/.test(verify) ? "PASS" : "WARN", "expects `realitygate check` or reality-check in verify.sh");
    add("gate runs the self-test", /realitygate(?:\.mjs)?\s+selftest|gate-selftest/.test(verify) ? "PASS" : "WARN", "expects `realitygate selftest` in verify.sh");
  } else {
    add("scripts/verify.sh", "FAIL", "missing — there is no definition of done");
  }

  let settings = null;
  if (has(".claude/settings.json")) {
    try {
      settings = JSON.parse(read(".claude/settings.json"));
    } catch {
      add(".claude/settings.json", "FAIL", "invalid JSON");
    }
  }
  const commands = new Set((settings?.hooks?.PreToolUse ?? []).flatMap((g) => (g.hooks ?? []).map((h) => h.command)));
  const missingHooks = HOOKS.filter((h) => !commands.has(commandFor(h.script)) || !has(`.claude/hooks/${h.script}`));
  add("guardrail hooks", missingHooks.length ? "WARN" : "PASS", missingHooks.length ? `not installed: ${missingHooks.map((h) => h.script).join(", ")} — run \`npx realitygate hooks install\` (not needed with the RealityGate plugin)` : "all installed");

  return summarize(results);
}

function summarize(results) {
  return { ok: results.every((r) => r.status !== "FAIL"), results };
}
