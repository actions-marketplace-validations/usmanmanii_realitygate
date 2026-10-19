import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { KIT_ROOT } from "./init.mjs";

// Matchers follow the Claude Code hooks reference: tool events match on
// tool_name; `A|B` matches either tool. Exit code 2 from a PreToolUse hook
// blocks the call and shows stderr to the agent.
export const HOOKS = [
  { script: "guard-secrets.mjs", matcher: "Read|Edit|Write|MultiEdit|NotebookEdit|Bash|Grep|Glob" },
  { script: "guard-git.mjs", matcher: "Bash" },
  { script: "guard-allowlist.mjs", matcher: "Edit|Write|MultiEdit|NotebookEdit" },
  { script: "guard-protected.mjs", matcher: "Edit|Write|MultiEdit|NotebookEdit" },
];

export const commandFor = (script) => `node "\${CLAUDE_PROJECT_DIR}/.claude/hooks/${script}"`;

/**
 * Copies the guard scripts into .claude/hooks/ and merges PreToolUse entries
 * into .claude/settings.json. Idempotent; leaves every other setting intact.
 */
export function installHooks(rootArg) {
  const root = resolve(rootArg);
  const hooksDir = join(root, ".claude", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  for (const { script } of HOOKS) copyFileSync(join(KIT_ROOT, "hooks", script), join(hooksDir, script));

  const settingsPath = join(root, ".claude", "settings.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch (e) {
      throw new Error(`.claude/settings.json is not valid JSON (${e.message}); fix it before installing hooks`);
    }
  }
  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];
  const pre = settings.hooks.PreToolUse;

  const added = [];
  for (const { script, matcher } of HOOKS) {
    const command = commandFor(script);
    const already = pre.some((group) => (group.hooks ?? []).some((h) => h.command === command));
    if (already) continue;
    pre.push({ matcher, hooks: [{ type: "command", command }] });
    added.push(script);
  }

  settings.permissions ??= {};
  settings.permissions.deny ??= [];
  for (const rule of ["Read(./.env)", "Read(./.env.*)"]) {
    if (!settings.permissions.deny.includes(rule)) settings.permissions.deny.push(rule);
  }

  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { added, scripts: HOOKS.map((h) => h.script), settingsPath };
}
