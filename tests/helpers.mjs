import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = join(KIT, "bin", "realitygate.mjs");

/** Creates a temp project from a { "path": "content" } map. */
export function makeProject(files = {}, { git = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vibe-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === "string" || Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 2));
  }
  if (git) {
    execFileSync("git", ["init", "-q"], { cwd: dir });
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function hasGit() {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function cli(args, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, ...opts });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function runHook(script, input, { projectDir, raw, args = [] } = {}) {
  const r = spawnSync(process.execPath, [join(KIT, "hooks", script), ...args], {
    input: raw ?? JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir ?? tmpdir() },
  });
  return { code: r.status, stderr: r.stderr };
}

// Strings assembled at runtime so this file never contains a literal credential.
export const FAKE_AWS_KEY = "AKIA" + "ABCDEFGHIJKLMNOP";
export const FAKE_STRIPE_KEY = "sk_live_" + "a1B2c3D4e5F6g7H8";
