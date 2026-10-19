import { builtinModules } from "node:module";
import { posix } from "node:path";
import { parseJsonc, readJson, readText } from "./files.mjs";

const { dirname } = posix;

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, m.replace(/^node:/, "")]));

const IMPORT_PATTERNS = [
  /^\s*(?:import|export)\b[^'"`]*?\bfrom\s+["']([^"']+)["']/,
  /^\s*\}\s*from\s+["']([^"']+)["']/,
  /^\s*import\s+["']([^"']+)["']/,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/,
];

// Imports resolved by a framework/bundler rather than by node_modules.
const SPECIFIER_PREFIX_SKIP = /^(?:\.|\/|@\/|~\/|~~\/|#|\$|virtual:|data:|https?:|node:|bun:|astro:|cloudflare:)/;

// Packages a framework provides without a separate dependency.
const FRAMEWORK_PROVIDED = {
  next: ["server-only", "client-only"],
};

export function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Finds import specifiers with 1-based line numbers. Skips comment lines. */
export function extractImports(content) {
  const found = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    for (const re of IMPORT_PATTERNS) {
      const m = re.exec(line);
      if (m) {
        found.push({ specifier: m[1], line: idx + 1 });
        break;
      }
    }
  });
  return found;
}

/**
 * Builds a resolver that answers "is this bare import declared anywhere a
 * package manager would install it from?" Declared = in the dependencies of a
 * package.json between the importing file and the repo root, a workspace
 * package name, a tsconfig `paths` alias, or a `baseUrl` directory.
 */
export function buildImportResolver(root, files) {
  const depsByDir = new Map();
  const workspaceNames = new Set();
  const aliasPrefixes = [];
  const baseUrlDirs = new Set();
  const fileSet = new Set(files);

  for (const f of files) {
    if (f === "package.json" || f.endsWith("/package.json")) {
      const pkg = readJson(root, f);
      if (!pkg) continue;
      const dir = f === "package.json" ? "" : dirname(f);
      const deps = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
        ...Object.keys(pkg.optionalDependencies ?? {}),
      ]);
      for (const [framework, extras] of Object.entries(FRAMEWORK_PROVIDED)) {
        if (deps.has(framework)) extras.forEach((e) => deps.add(e));
      }
      depsByDir.set(dir, deps);
      if (typeof pkg.name === "string") workspaceNames.add(pkg.name);
      if (pkg.imports && typeof pkg.imports === "object") {
        Object.keys(pkg.imports).forEach((k) => aliasPrefixes.push(k.replace(/\*.*$/, "")));
      }
    }
    if (/(?:^|\/)(?:ts|js)config(?:\.[\w-]+)?\.json$/.test(f)) {
      let cfg = null;
      try {
        const text = readText(root, f);
        cfg = text ? parseJsonc(text) : null;
      } catch {
        cfg = null;
      }
      const opts = cfg?.compilerOptions ?? {};
      for (const key of Object.keys(opts.paths ?? {})) {
        const prefix = key.replace(/\*.*$/, "");
        if (prefix) aliasPrefixes.push(prefix);
      }
      if (typeof opts.baseUrl === "string") {
        const cfgDir = f.includes("/") ? dirname(f) : "";
        const base = normalize(cfgDir ? `${cfgDir}/${opts.baseUrl}` : opts.baseUrl);
        baseUrlDirs.add(base);
      }
    }
  }

  const topLevelDirsUnder = (base) => {
    const prefix = base ? `${base}/` : "";
    const dirs = new Set();
    for (const f of fileSet) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash > 0) dirs.add(rest.slice(0, slash));
      else dirs.add(rest.replace(/\.[^.]+$/, ""));
    }
    return dirs;
  };
  const baseUrlEntries = new Set([...baseUrlDirs].flatMap((b) => [...topLevelDirsUnder(b)]));

  const hasAnyPackageJson = depsByDir.size > 0;

  return {
    hasAnyPackageJson,
    isDeclared(file, specifier) {
      if (SPECIFIER_PREFIX_SKIP.test(specifier)) return true;
      if (aliasPrefixes.some((p) => specifier.startsWith(p))) return true;
      const name = packageName(specifier);
      if (BUILTINS.has(name) || BUILTINS.has(specifier)) return true;
      if (workspaceNames.has(name)) return true;
      if (baseUrlEntries.has(name)) return true;
      let dir = file.includes("/") ? dirname(file) : "";
      for (;;) {
        if (depsByDir.get(dir)?.has(name)) return true;
        if (dir === "") break;
        dir = dir.includes("/") ? dirname(dir) : "";
      }
      return false;
    },
  };
}

function normalize(path) {
  const out = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}
