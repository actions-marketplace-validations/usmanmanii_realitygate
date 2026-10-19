import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE } from "./config.mjs";

export const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const KIT_FILES = ["BUILD-OS.md", "START-HERE.md", "docs/IDEA.md", "docs/input/README.md"];

/** Build OS subagents (BUILD-OS Part 4), copied from templates/agents/ into the project. */
export const AGENT_NAMES = ["planner", "spec-critic", "verifier", "security-auditor", "drift-auditor", "researcher"];
export const KIT_AGENTS = AGENT_NAMES.map((name) => ({ from: `templates/agents/${name}.md`, to: `.claude/agents/${name}.md` }));

export const STARTER_CONFIG = {
  include: [],
  exclude: [],
  disable: [],
  mayBeEmpty: {},
  rules: [],
  fileRules: [],
  hooks: { protectedPaths: [], appliedMigrationsManifest: null },
};

/**
 * Copies the kit's markdown and subagents into a project, and optionally the user's SRS
 * into docs/input/. Never overwrites unless `force`.
 */
export function runInit(rootArg, { force = false, srs } = {}) {
  const root = resolve(rootArg);
  const srsSource = srs === undefined ? null : checkSrs(srs);
  const results = [];
  const copy = (from, to) => {
    const dest = join(root, to);
    const existed = existsSync(dest);
    if (existed && !force) {
      results.push({ file: to, action: "skipped (exists)" });
      return;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(from, dest);
    results.push({ file: to, action: existed ? "overwritten" : "created" });
  };

  for (const rel of KIT_FILES) copy(join(KIT_ROOT, rel), rel);
  for (const agent of KIT_AGENTS) copy(join(KIT_ROOT, agent.from), agent.to);
  if (srsSource) copy(srsSource, `docs/input/${basename(srsSource)}`);

  const cfg = join(root, CONFIG_FILE);
  if (existsSync(cfg) && !force) {
    results.push({ file: CONFIG_FILE, action: "skipped (exists)" });
  } else {
    writeFileSync(cfg, `${JSON.stringify(STARTER_CONFIG, null, 2)}\n`);
    results.push({ file: CONFIG_FILE, action: "created" });
  }
  return results;
}

/** The SRS must be an existing file, and never a secrets file. */
function checkSrs(path) {
  const abs = resolve(String(path));
  const fail = (message) => {
    const e = new Error(message);
    e.code = "BAD_INPUT";
    return e;
  };
  if (/^\.env/i.test(basename(abs))) throw fail(`refusing to copy ${basename(abs)}: secrets never go in docs/input/`);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw fail(`--srs: no such file: ${path}`);
  return abs;
}
