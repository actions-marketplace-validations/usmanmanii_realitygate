import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { KIT_ROOT } from "./init.mjs";

export const SKILL_NAMES = ["audit", "fix", "gate", "build", "review", "scan"];
const START = "<!-- realitygate:start -->";
const END = "<!-- realitygate:end -->";

/**
 * Converts a Claude Code plugin skill into a portable Agent Skill (the open
 * SKILL.md standard read by Codex, Antigravity CLI and other agents): the
 * plugin-root CLI path becomes `npx --yes realitygate`, plugin-only fallback
 * paragraphs are dropped, and names get a `realitygate-` prefix so they don't
 * collide with other skills in a shared skills directory.
 */
export function portableSkill(source, name) {
  const paragraphs = source
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .filter((p) => !/outside the plugin/i.test(p));
  return `${paragraphs.join("\n\n").trimEnd()}\n`
    .replace(/^name: (\S+)$/m, `name: realitygate-${name}`)
    .replace(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/realitygate\.mjs"/g, "npx --yes realitygate")
    .replace(/the `(audit|fix|gate|build|review)` skill/g, "the `realitygate-$1` skill");
}

export function portableSkills() {
  return SKILL_NAMES.map((name) => ({
    dir: `realitygate-${name}`,
    content: portableSkill(readFileSync(join(KIT_ROOT, "skills", name, "SKILL.md"), "utf8"), name),
  }));
}

/** Shared rules for every assistant (kept as Markdown: it quotes the phrases the gate forbids). */
export const INSTRUCTIONS = readFileSync(join(KIT_ROOT, "templates", "agent-instructions.md"), "utf8");

const CURSOR_RULE = `---
description: RealityGate rules: keep AI-written code real (no stubs, fabricated records, invented packages, leaked secrets); run the Reality Gate before finishing a task
globs:
alwaysApply: true
---

${INSTRUCTIONS}`;

/** Writes integration files for coding assistants other than Claude Code. Idempotent. */
export function installAgents(rootArg) {
  const root = resolve(rootArg);
  const written = [];

  for (const skill of portableSkills()) {
    const rel = `.agents/skills/${skill.dir}/SKILL.md`;
    writeFile(root, rel, skill.content);
    written.push({ file: rel, for: "Codex, Antigravity CLI and other Agent Skills tools" });
  }
  written.push({ file: upsertBlock(root, "AGENTS.md", INSTRUCTIONS), for: "Codex, Antigravity CLI, and other tools that read AGENTS.md" });
  written.push({ file: upsertBlock(root, "GEMINI.md", INSTRUCTIONS), for: "Gemini CLI / Antigravity CLI context" });
  written.push({ file: upsertBlock(root, ".github/copilot-instructions.md", INSTRUCTIONS), for: "GitHub Copilot" });
  writeFile(root, ".cursor/rules/realitygate.mdc", CURSOR_RULE);
  written.push({ file: ".cursor/rules/realitygate.mdc", for: "Cursor" });
  return written;
}

/** Inserts or replaces the RealityGate block between markers, keeping the rest of the file. */
export function upsertBlock(root, rel, body) {
  const abs = join(root, rel);
  const block = `${START}\n${body.trimEnd()}\n${END}\n`;
  let text = existsSync(abs) ? readFileSync(abs, "utf8") : "";
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start !== -1 && end > start) {
    text = text.slice(0, start) + block + text.slice(end + END.length).replace(/^\r?\n/, "");
  } else {
    text = text ? `${text.trimEnd()}\n\n${block}` : block;
  }
  writeFile(root, rel, text);
  return rel;
}

export function stripBlock(text) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  return start !== -1 && end > start ? (text.slice(0, start) + text.slice(end + END.length)).trim() : text.trim();
}

export const PRE_COMMIT = `#!/bin/sh
# RealityGate pre-commit gate: blocks commits that contain fake code, invented
# packages or leaked secrets. Works with every coding agent and every human,
# because they all commit through git.
if [ -x ./node_modules/.bin/realitygate ]; then
  exec ./node_modules/.bin/realitygate check
fi
exec npx --yes realitygate check
`;

/**
 * Installs a git pre-commit hook running the Reality Gate. Honors core.hooksPath.
 * Never overwrites a pre-commit hook it didn't write.
 */
export function installGitHook(rootArg) {
  const root = resolve(rootArg);
  let hooksDir;
  try {
    hooksDir = execFileSync("git", ["rev-parse", "--git-path", "hooks"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    const e = new Error("not a git repository — run `git init` first");
    e.code = "BAD_INPUT";
    throw e;
  }
  const dir = isAbsolute(hooksDir) ? hooksDir : join(root, hooksDir);
  const path = join(dir, "pre-commit");
  if (existsSync(path) && !readFileSync(path, "utf8").includes("RealityGate pre-commit gate")) {
    const e = new Error(`${path} already exists and was not written by RealityGate; add \`npx --yes realitygate check\` to it yourself`);
    e.code = "BAD_INPUT";
    throw e;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, PRE_COMMIT);
  chmodSync(path, 0o755);
  return path;
}

function writeFile(root, rel, content) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
