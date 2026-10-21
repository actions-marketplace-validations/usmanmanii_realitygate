import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
  "coverage", ".turbo", ".expo", ".vercel", ".output", "vendor", ".venv", "venv",
  "__pycache__", ".pytest_cache", ".mypy_cache", "target", ".gradle", "Pods",
]);

const MAX_FILE_BYTES = 1024 * 1024;

export const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|py|go)$/;
export const TS_EXT = /\.(?:[cm]?tsx?)$/;
export const JS_TS_EXT = /\.(?:[cm]?[jt]sx?)$/;
export const CONFIG_TEXT_EXT = /\.(?:json|ya?ml|toml)$/;

/** `.env`, `.env.local`, … but not `.env.example` / `.sample` / `.template`. */
export function isSecretEnvFile(path) {
  const name = basename(path);
  return /^\.env(?:\..+)?$/.test(name) && !/\.(?:example|sample|template|dist)$/.test(name);
}

export function isTestFile(path) {
  return (
    /(?:^|\/)(?:tests?|__tests__|__mocks__|e2e|spec|specs|fixtures?|cypress|playwright)\//.test(path) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) ||
    /(?:^|\/)test_[^/]*\.py$/.test(path) ||
    /_test\.(?:py|go)$/.test(path)
  );
}

/**
 * Every file in the project, repo-relative and POSIX-separated.
 * Inside a git work tree this is tracked + untracked-but-not-ignored files:
 * a new file is untracked right up until the commit a gate is guarding, so
 * scanning only tracked files would inspect nothing when it matters most.
 */
export function listFiles(root) {
  const files = gitFiles(root) ?? walk(root, "");
  return files.filter((f) => !f.split("/").some((seg) => SKIP_DIRS.has(seg)));
}

function gitFiles(root) {
  let out;
  try {
    out = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 512 * 1024 * 1024 },
    );
  } catch {
    return null;
  }
  return out.split("\0").filter((f) => {
    if (!f) return false;
    const abs = join(root, f);
    return existsSync(abs) && statSync(abs).isFile();
  });
}

function walk(root, rel) {
  const result = [];
  let entries;
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) result.push(...walk(root, childRel));
    } else if (entry.isFile()) {
      result.push(childRel);
    }
  }
  return result;
}

export function isGitRepo(root) {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Reads a text file, refusing secret env files, oversized and minified files. */
export function readText(root, rel) {
  if (isSecretEnvFile(rel)) return null;
  if (/\.min\.[cm]?js$/.test(rel)) return null;
  const abs = join(root, rel);
  const size = statSync(abs).size;
  if (size > MAX_FILE_BYTES) return null;
  return readFileSync(abs, "utf8");
}

export function readJson(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

/** JSON with comments and trailing commas (tsconfig style). */
export function parseJsonc(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}
