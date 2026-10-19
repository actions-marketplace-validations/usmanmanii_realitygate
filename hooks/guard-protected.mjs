#!/usr/bin/env node
// Claude Code PreToolUse hook (matcher: Edit|Write|MultiEdit|NotebookEdit):
// blocks edits to protected files declared in realitygate.config.json:
//   hooks.protectedPaths            — globs, e.g. ["supabase/migrations/meta/**"]
//   hooks.appliedMigrationsManifest — a JSON file whose keys (object) or items
//                                     (array) name applied migrations, relative
//                                     to the manifest's directory. Applied
//                                     migrations are immutable; new ones are fine.
// Exit 2 = block. Fails closed on unparsable input or config.

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

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

const block = (msg) => {
  process.stderr.write(`Blocked by guard-protected: ${msg}\n`);
  process.exit(2);
};

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  block("could not parse hook input; blocking to stay safe");
}

const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd());
const configPath = join(projectDir, "realitygate.config.json");
if (!existsSync(configPath)) process.exit(0);

let hooks;
try {
  hooks = JSON.parse(readFileSync(configPath, "utf8")).hooks ?? {};
} catch {
  block("realitygate.config.json is not valid JSON; fix it (the human may need to) before editing files");
}

const target = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
if (typeof target !== "string" || !target) process.exit(0);
const rel = relative(projectDir, isAbsolute(target) ? target : resolve(projectDir, target)).split("\\").join("/");
if (rel.startsWith("../")) process.exit(0);

for (const glob of Array.isArray(hooks.protectedPaths) ? hooks.protectedPaths : []) {
  if (typeof glob === "string" && globToRegExp(glob).test(rel)) {
    block(`${rel} is a protected path (realitygate.config.json hooks.protectedPaths). Ask the human before changing it.`);
  }
}

if (typeof hooks.appliedMigrationsManifest === "string") {
  const manifestRel = hooks.appliedMigrationsManifest.split("\\").join("/");
  const manifestAbs = join(projectDir, manifestRel);
  if (existsSync(manifestAbs)) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestAbs, "utf8"));
    } catch {
      block(`${manifestRel} is not valid JSON; cannot tell which migrations are applied`);
    }
    const names = Array.isArray(manifest) ? manifest : Object.keys(manifest ?? {});
    const baseDir = dirname(manifestRel) === "." ? "" : `${dirname(manifestRel)}/`;
    if (rel === manifestRel) block(`${rel} is the applied-migrations manifest; only the migration tooling may change it.`);
    if (names.some((n) => typeof n === "string" && `${baseDir}${n}` === rel)) {
      block(`${rel} is an APPLIED migration and is immutable. Write a new numbered migration instead.`);
    }
  }
}
process.exit(0);
