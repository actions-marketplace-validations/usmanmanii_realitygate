#!/usr/bin/env node
// Claude Code PreToolUse hook (matcher: Edit|Write|MultiEdit|NotebookEdit):
// while a task is in TESTS or IMPLEMENT, only files listed in .agent/ALLOWLIST
// (one glob per line, # comments) may be edited. .agent/** is always editable.
// Inactive when .agent/ALLOWLIST does not exist. Exit 2 = block.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

function globToRegExp(glob) {
  let re = "";
  let depth = 0;
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if ((i === 0 || glob[i - 1] === "/") && glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else if (ch === "{") {
      depth++;
      re += "(?:";
    } else if (ch === "}" && depth > 0) {
      depth--;
      re += ")";
    } else if (ch === "," && depth > 0) re += "|";
    else re += ch.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.stderr.write("guard-allowlist: could not parse hook input; blocking to stay safe\n");
  process.exit(2);
}

const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd());
const allowlistPath = join(projectDir, ".agent", "ALLOWLIST");
if (!existsSync(allowlistPath)) process.exit(0);

const statePath = join(projectDir, ".agent", "STATE.json");
if (existsSync(statePath)) {
  let step = null;
  try {
    step = JSON.parse(readFileSync(statePath, "utf8")).current_step ?? null;
  } catch {
    step = null;
  }
  if (step !== null && !["TESTS", "IMPLEMENT"].includes(String(step).toUpperCase())) process.exit(0);
}

const target = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
if (typeof target !== "string" || !target) process.exit(0);

const abs = isAbsolute(target) ? target : resolve(projectDir, target);
const rel = relative(projectDir, abs).split("\\").join("/");
if (rel.startsWith("../") || isAbsolute(rel)) process.exit(0);
if (rel === ".agent" || rel.startsWith(".agent/")) process.exit(0);

const globs = readFileSync(allowlistPath, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

if (globs.some((g) => globToRegExp(g).test(rel))) process.exit(0);

process.stderr.write(
  `Blocked by guard-allowlist: ${rel} is not in this task's allowlist (.agent/ALLOWLIST). ` +
    "Stop and tell the human which file must change and why; do not expand scope silently.\n",
);
process.exit(2);
