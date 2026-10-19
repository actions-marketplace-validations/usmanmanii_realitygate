#!/usr/bin/env node
// Claude Code PreToolUse hook: blocks any tool call that reads, writes, greps or
// shells out against a secret env file (.env, .env.local, .env*). `.env.example`,
// `.env.sample`, `.env.template` and `.env.dist` stay allowed.
// Exit 2 = block (stderr is shown to the agent). Fails closed on unparsable input.

import { existsSync } from "node:fs";
import { join } from "node:path";

const SAFE_SUFFIX = /\.(?:example|sample|template|dist)(?:\.|$)/;

function touchesEnv(value) {
  if (typeof value !== "string" || !value) return false;
  const name = value.replace(/\\/g, "/").split("/").pop();
  return /^\.env(?:\..+|\*.*)?$/.test(name) && !SAFE_SUFFIX.test(name);
}

function commandTouchesEnv(command) {
  if (typeof command !== "string") return false;
  const re = /(?:^|[\s"'=/<>|;&(:])(\.env(?:\.[\w.*-]+|\*)?)(?=$|[\s"'|;&>)<])/g;
  for (const m of command.matchAll(re)) if (!SAFE_SUFFIX.test(m[1])) return true;
  return false;
}

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.stderr.write("guard-secrets: could not parse hook input; blocking to stay safe\n");
  process.exit(2);
}

// Installed through the Claude Code plugin (--plugin), this guard applies only in
// projects that opted in to RealityGate by having realitygate.config.json.
// Project-installed hooks (realitygate hooks install) always apply.
if (process.argv.includes("--plugin")) {
  const optedIn = existsSync(join(process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd(), "realitygate.config.json"));
  if (!optedIn) process.exit(0);
}

const ti = input?.tool_input ?? {};
// Tool-agnostic: any tool with a shell `command` is checked as a shell call, and every
// path-like argument is checked, whatever the assistant names its tools.
const blocked =
  (typeof ti.command === "string" && commandTouchesEnv(ti.command)) ||
  [ti.file_path, ti.absolute_path, ti.notebook_path, ti.path, ti.glob, /glob/i.test(String(input?.tool_name)) ? ti.pattern : null].some(touchesEnv);

if (blocked) {
  process.stderr.write(
    "Blocked by guard-secrets: secret env files are off-limits to the agent. " +
      "The human manages .env files; ask for the variable NAME you need (add it to .env.example), never its value.\n",
  );
  process.exit(2);
}
process.exit(0);
