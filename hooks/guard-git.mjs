#!/usr/bin/env node
// Claude Code PreToolUse hook (matcher: Bash): blocks destructive git commands,
// hook-skipping flags, and commits while the gate is not GREEN in
// .agent/STATE.json. Exit 2 = block. Fails closed on unparsable input.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DESTRUCTIVE = [
  [/\bgit\s+(?:-\S+\s+)*reset\s+(?:.*\s)?--hard\b/, "git reset --hard discards work"],
  [/\bgit\s+(?:-\S+\s+)*push\b.*(?:\s--force(?:-with-lease)?\b|\s-[a-zA-Z]*f\b|\s\+\S)/, "force-push rewrites shared history"],
  [/\bgit\s+(?:-\S+\s+)*push\b.*\s--delete\b|\bgit\s+(?:-\S+\s+)*push\s+\S+\s+:\S/, "deleting remote branches"],
  [/\bgit\s+(?:-\S+\s+)*clean\s+(?:.*\s)?-[a-zA-Z]*f/, "git clean -f deletes untracked files"],
  [/\bgit\s+(?:-\S+\s+)*checkout\s+(?:.*\s)?(?:--\s+)?\.(?:\s|$)/, "git checkout . discards uncommitted changes"],
  [/\bgit\s+(?:-\S+\s+)*restore\s+(?:.*\s)?\.(?:\s|$)/, "git restore . discards uncommitted changes"],
  [/\bgit\s+(?:-\S+\s+)*branch\s+(?:.*\s)?-D\b/, "force-deleting a branch"],
  [/\bgit\s+(?:-\S+\s+)*stash\s+(?:drop|clear)\b/, "dropping stashed work"],
  [/--no-verify\b/, "--no-verify skips the hooks that guard commits"],
  [/-c\s+commit\.gpgsign=false\b|--no-gpg-sign\b/, "bypassing commit signing"],
];

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.stderr.write("guard-git: could not parse hook input; blocking to stay safe\n");
  process.exit(2);
}

// Installed through the Claude Code plugin (--plugin), this guard applies only in
// projects that opted in to RealityGate by having realitygate.config.json.
// Project-installed hooks (realitygate hooks install) always apply.
if (process.argv.includes("--plugin")) {
  const optedIn = existsSync(join(process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd(), "realitygate.config.json"));
  if (!optedIn) process.exit(0);
}

const command = String(input?.tool_input?.command ?? "");
for (const [re, why] of DESTRUCTIVE) {
  if (re.test(command)) {
    process.stderr.write(`Blocked by guard-git: ${why}. If this is truly needed, ask the human to run it themselves.\n`);
    process.exit(2);
  }
}

if (/\bgit\s+(?:-\S+\s+)*commit\b/.test(command)) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
  const statePath = join(projectDir, ".agent", "STATE.json");
  if (existsSync(statePath)) {
    let status = null;
    try {
      status = JSON.parse(readFileSync(statePath, "utf8")).verify_status ?? null;
    } catch {
      status = "UNREADABLE";
    }
    if (status !== "GREEN") {
      process.stderr.write(
        `Blocked by guard-git: .agent/STATE.json verify_status is ${status ?? "unset"}, not GREEN. ` +
          "Run `bash scripts/verify.sh`, record GREEN in STATE.json, then commit. Never commit on a red gate.\n",
      );
      process.exit(2);
    }
  }
}
process.exit(0);
