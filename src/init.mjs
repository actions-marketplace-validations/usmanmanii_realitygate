import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE } from "./config.mjs";

export const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const KIT_FILES = ["BUILD-OS.md", "START-HERE.md", "docs/IDEA.md", "docs/input/README.md"];

export const STARTER_CONFIG = {
  include: [],
  exclude: [],
  disable: [],
  mayBeEmpty: {},
  rules: [],
  fileRules: [],
  hooks: { protectedPaths: [], appliedMigrationsManifest: null },
};

/** Copies the kit's markdown into a project. Never overwrites unless `force`. */
export function runInit(rootArg, { force = false } = {}) {
  const root = resolve(rootArg);
  const results = [];
  for (const rel of KIT_FILES) {
    const dest = join(root, rel);
    const existed = existsSync(dest);
    if (existed && !force) {
      results.push({ file: rel, action: "skipped (exists)" });
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(KIT_ROOT, rel), dest);
    results.push({ file: rel, action: existed ? "overwritten" : "created" });
  }
  const cfg = join(root, CONFIG_FILE);
  if (existsSync(cfg) && !force) {
    results.push({ file: CONFIG_FILE, action: "skipped (exists)" });
  } else {
    writeFileSync(cfg, `${JSON.stringify(STARTER_CONFIG, null, 2)}\n`);
    results.push({ file: CONFIG_FILE, action: "created" });
  }
  return results;
}
