// R-021: a declared dependency the lockfile has never seen. R-014 only checks
// imports against the manifest, so a package an agent invented *and* added to
// package.json passed it. Only a real install from a registry writes a
// lockfile entry, so a missing one is offline evidence that the package was
// never installed, and may not exist. An entry proves the package resolved;
// it doesn't prove the package is safe.
//
// Formats (checked against real files from npm 11, pnpm 11, bun 1.2, yarn 1
// and uv, and the go.sum and Pipfile.lock docs):
//   package-lock.json   "packages": { "node_modules/<name>": … } (v2/v3), "dependencies" (v1)
//   pnpm-lock.yaml      "  <name>@<version>:" or "  '/<name>/<version>':" (v5)
//   yarn.lock           "<name>@<range>:", "<a>@x, <name>@y:", berry "\"<name>@npm:<range>\":"
//   bun.lock            "<name>": ["<name>@<version>", …]
//   poetry/uv/pdm.lock  [[package]] name = "<name>"
//   Pipfile.lock        { "default": { "<name>": … }, "develop": …, custom categories }
//   go.sum              "<module> <version>[/go.mod] h1:<hash>"

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { isPythonManifest, pythonManifestDeps } from "./langs.mjs";

const { basename, dirname } = posix;
const MAX_LOCK_BYTES = 128 * 1024 * 1024;

// Files that declare what code may import: npm, Python and Go manifests.
export const MANIFEST = /(?:^|\/)(?:package\.json|requirements[\w.-]*\.(?:txt|in)|requirements\/[\w.-]+\.(?:txt|in)|pyproject\.toml|Pipfile|setup\.py|setup\.cfg|go\.mod|go\.work)$/;

const NPM_LOCKS = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"];
const PY_LOCKS = ["poetry.lock", "uv.lock", "pdm.lock", "Pipfile.lock"];
export const LOCKFILE = new RegExp(`(?:^|/)(?:${[...NPM_LOCKS, "bun.lockb", ...PY_LOCKS, "go.sum"].map((l) => l.replace(/\./g, "\\.")).join("|")})$`);
// Dependencies that live in the repo or on disk, never in a registry.
const LOCAL_SPEC = /^(?:workspace:|file:|link:|portal:)/;

const pep503 = (name) => name.toLowerCase().replace(/[-_.]+/g, "-");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function readLock(root, rel) {
  const abs = join(root, rel);
  try {
    if (!existsSync(abs) || statSync(abs).size > MAX_LOCK_BYTES) return null;
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/**
 * The lockfiles of one ecosystem next to the manifest, else in the nearest
 * folder above that is a workspace root. A lockfile in a plain parent folder
 * belongs to another project and says nothing about this one.
 */
function nearestLocks(allFiles, manifest, names, isWorkspaceRoot) {
  const present = new Set(allFiles);
  const here = dirname(manifest);
  for (let dir = here; ; dir = dirname(dir)) {
    const prefix = dir === "." ? "" : `${dir}/`;
    if (dir === here || isWorkspaceRoot(prefix)) {
      const found = names.map((n) => prefix + n).filter((p) => present.has(p));
      if (found.length) return found;
    }
    if (dir === "." || dir === "") return [];
  }
}

function lineOf(content, needle) {
  const i = content.indexOf(needle);
  return i < 0 ? 1 : content.slice(0, i).split("\n").length;
}

/** Locked npm package names, or a test for one when the format is only searchable as text. */
function npmLocked(root, lock) {
  const text = readLock(root, lock);
  if (text === null) return null;
  if (lock.endsWith(".json")) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    const names = new Set(Object.keys(data.dependencies ?? {}));
    for (const key of Object.keys(data.packages ?? {})) {
      const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
      if (m) names.add(m[1]);
    }
    return (name) => names.has(name);
  }
  const n = (name) => escape(name);
  if (lock.endsWith("pnpm-lock.yaml")) return (name) => new RegExp(`^\\s*['"]?/?${n(name)}(?:@|/)\\S*['"]?:`, "m").test(text);
  if (lock.endsWith("yarn.lock")) return (name) => new RegExp(`(?:^"?|, "?)${n(name)}@`, "m").test(text);
  return (name) => text.includes(`"${name}@`); // bun.lock
}

function pythonLocked(root, lock) {
  const text = readLock(root, lock);
  if (text === null) return null;
  const names = new Set();
  if (lock.endsWith("Pipfile.lock")) {
    try {
      const data = JSON.parse(text);
      for (const [section, pkgs] of Object.entries(data)) if (section !== "_meta" && pkgs && typeof pkgs === "object") Object.keys(pkgs).forEach((k) => names.add(pep503(k)));
    } catch {
      return null;
    }
  } else {
    for (const m of text.matchAll(/^name\s*=\s*"([^"]+)"/gm)) names.add(pep503(m[1]));
  }
  return (name) => names.has(pep503(name));
}

function goRequires(content) {
  const requires = [];
  const localReplace = new Set();
  let block = null;
  content.split(/\r?\n/).forEach((line, i) => {
    const open = /^\s*(require|replace)\s*\(\s*$/.exec(line);
    if (open) return void (block = open[1]);
    if (block && /^\s*\)/.test(line)) return void (block = null);
    const req = block === "require" ? /^\s*(\S+)\s+v\S+/.exec(line) : /^\s*require\s+(\S+)\s+v\S+/.exec(line);
    if (req && !req[1].startsWith("//")) requires.push({ name: req[1], line: i + 1 });
    const rep = block === "replace" ? /^\s*(\S+)(?:\s+\S+)?\s+=>\s+(\S+)/.exec(line) : /^\s*replace\s+(\S+)(?:\s+\S+)?\s+=>\s+(\S+)/.exec(line);
    if (rep && /^(?:\.{1,2}\/|\/|[A-Za-z]:[\\/])/.test(rep[2])) localReplace.add(rep[1]);
  });
  return requires.filter((r) => !localReplace.has(r.name));
}

/** Names of every package.json in the repo: workspace siblings that no registry serves. */
function workspaceNames(root, allFiles) {
  const names = new Set();
  for (const f of allFiles) {
    if (basename(f) !== "package.json") continue;
    try {
      const name = JSON.parse(readFileSync(join(root, f), "utf8")).name;
      if (typeof name === "string") names.add(name);
    } catch {
      // not valid JSON: R-014 and npm itself report that
    }
  }
  return names;
}

/** Builds the R-021 check for one project; lockfiles are read once and cached. */
export function buildLockIndex(root, allFiles) {
  const cache = new Map();
  let workspaces = null;
  const present = new Set(allFiles);
  const text = (rel) => (present.has(rel) ? readLock(root, rel) ?? "" : "");
  // npm/yarn/bun: a "workspaces" field; pnpm: pnpm-workspace.yaml; uv: [tool.uv.workspace].
  const npmRoot = (prefix) => present.has(`${prefix}pnpm-workspace.yaml`) || /"workspaces"\s*:/.test(text(`${prefix}package.json`));
  const pyRoot = (prefix) => /^\s*\[tool\.uv\.workspace\]/m.test(text(`${prefix}pyproject.toml`));
  const locked = (lock, reader) => {
    if (!cache.has(lock)) cache.set(lock, reader(root, lock));
    return cache.get(lock);
  };
  const verdict = (manifest, deps, lockNames, reader, kind, locks = nearestLocks(allFiles, manifest, lockNames, kind === "npm" ? npmRoot : pyRoot)) => {
    if (deps.length === 0) return [];
    if (locks.length === 0) {
      const binary = kind === "npm" && nearestLocks(allFiles, manifest, ["bun.lockb"], npmRoot).length > 0;
      return [{ line: 1, severity: "warn", text: `can't verify ${deps.length} dependenc${deps.length === 1 ? "y" : "ies"}: ${binary ? "bun.lockb is binary (run `bun install --save-text-lockfile`)" : kind === "go.sum" ? "no go.sum next to go.mod" : `no ${kind} lockfile found`}` }];
    }
    const tests = locks.map((l) => locked(l, reader)).filter(Boolean);
    if (tests.length === 0) return [{ line: 1, severity: "warn", text: `can't verify: ${locks.join(", ")} could not be read` }];
    return deps
      .filter((d) => !tests.some((has) => has(d.name)))
      .map((d) => ({ line: d.line, text: `"${d.name}" is declared but not in ${locks.join(", ")}: never installed, so nothing shows it exists (install it, or the lockfile is stale)` }));
  };

  return {
    check(file, content) {
      const name = basename(file);
      if (name === "package.json") {
        let pkg;
        try {
          pkg = JSON.parse(content);
        } catch {
          return [];
        }
        workspaces ??= workspaceNames(root, allFiles);
        const deps = [];
        for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
          for (const [dep, spec] of Object.entries(pkg[field] ?? {})) {
            if (typeof spec !== "string" || LOCAL_SPEC.test(spec) || workspaces.has(dep)) continue;
            deps.push({ name: dep, line: lineOf(content, `"${dep}"`) });
          }
        }
        return verdict(file, deps, NPM_LOCKS, npmLocked, "npm");
      }
      if (isPythonManifest(file)) {
        const deps = [...pythonManifestDeps(file, content, { buildSystem: false })].map((dep) => ({ name: dep, line: lineOf(content, dep) }));
        return verdict(file, deps, PY_LOCKS, pythonLocked, "Python");
      }
      if (name === "go.mod") {
        const sum = (_root, lock) => {
          const text = readLock(root, lock);
          if (text === null) return null;
          const modules = new Set([...text.matchAll(/^(\S+)\s+v\S+\s+h\d+:/gm)].map((m) => m[1]));
          return (mod) => modules.has(mod);
        };
        // go.sum sits next to its go.mod; a parent folder's belongs to another module.
        const lock = dirname(file) === "." ? "go.sum" : `${dirname(file)}/go.sum`;
        return verdict(file, goRequires(content), [], sum, "go.sum", allFiles.includes(lock) ? [lock] : []);
      }
      return [];
    },
  };
}
