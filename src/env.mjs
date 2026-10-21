// Environment variables the code reads, and the ones a project documents in
// `.env.example` (or .sample/.template/.dist). Secret env files are never
// read: only the example files, which hold names and placeholder values.

import { readText } from "./files.mjs";

export const ENV_EXAMPLE_FILE = /(?:^|\/)\.env(?:\.[\w-]+)?\.(?:example|sample|template|dist)$/;

const JS_READS = [
  /\bprocess\.env\.([A-Za-z_]\w*)/g,
  /\bprocess\.env\[\s*["'`]([A-Za-z_]\w*)["'`]\s*\]/g,
  /\bimport\.meta\.env\.([A-Za-z_]\w*)/g,
  /\bBun\.env\.([A-Za-z_]\w*)/g,
  /\bDeno\.env\.get\(\s*["'`]([A-Za-z_]\w*)["'`]\s*\)/g,
];
const JS_DESTRUCTURE = /\{([^}]+)\}\s*=\s*(?:process\.env|import\.meta\.env)\b/g;
const PY_READS = [
  /\bos\.environ\[\s*["']([A-Za-z_]\w*)["']\s*\]/g,
  /\b(?:os\.)?environ\.get\(\s*["']([A-Za-z_]\w*)["']/g,
  /\bos\.getenv\(\s*["']([A-Za-z_]\w*)["']/g,
];
const GO_READS = [/\bos\.(?:Getenv|LookupEnv)\(\s*"([A-Za-z_]\w*)"\s*\)/g];

// Set by the OS, the shell, the package manager, CI, the hosting platform or
// the framework itself, never by the app's own config. Listed in the README.
const PROVIDED = new Set([
  "NODE_ENV", "NODE_OPTIONS", "CI", "PORT", "HOSTNAME", "HOME", "USERPROFILE", "PATH", "PWD",
  "TMPDIR", "TEMP", "TMP", "TZ", "LANG", "SHELL", "TERM", "USER", "NO_COLOR", "FORCE_COLOR",
  "DEBUG", "APPDATA", "LOCALAPPDATA", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "NETLIFY", "RENDER",
  "K_SERVICE", "NEXT_RUNTIME", "NEXT_PHASE", "JEST_WORKER_ID", "VITEST", "VIRTUAL_ENV", "PYTHONPATH",
  "GOPATH", "GOOS", "GOARCH",
]);
const PROVIDED_PREFIX = /^(?:npm_|GITHUB_|RUNNER_|VERCEL_|NEXT_PUBLIC_VERCEL_|VITE_VERCEL_|RAILWAY_|FLY_|CF_PAGES|AWS_LAMBDA_|CLAUDE_)/;
// Vite and Astro define these on import.meta.env themselves.
const IMPORT_META_BUILTINS = new Set(["MODE", "BASE_URL", "PROD", "DEV", "SSR", "SITE", "ASSETS_PREFIX"]);

export const isProvided = (name) => PROVIDED.has(name) || PROVIDED_PREFIX.test(name);

/** Every env var a file reads by a literal name, with 1-based line numbers. */
export function extractEnvReads(file, content) {
  const patterns = /\.py$/.test(file) ? PY_READS : /\.go$/.test(file) ? GO_READS : JS_READS;
  const comment = /\.py$/.test(file) ? /^\s*#/ : /^\s*(?:\/\/|\*|\/\*)/;
  const found = [];
  content.split(/\r?\n/).forEach((line, i) => {
    if (comment.test(line)) return;
    for (const re of patterns) {
      for (const m of line.matchAll(re)) {
        if (re.source.includes("import\\.meta") && IMPORT_META_BUILTINS.has(m[1])) continue;
        found.push({ name: m[1], line: i + 1, text: line });
      }
    }
    if (patterns === JS_READS) {
      for (const m of line.matchAll(JS_DESTRUCTURE)) {
        for (const part of m[1].split(",")) {
          const name = /^\s*(?:\.\.\.)?([A-Za-z_]\w*)/.exec(part)?.[1];
          if (name && !part.trim().startsWith("...") && !IMPORT_META_BUILTINS.has(name)) found.push({ name, line: i + 1, text: line });
        }
      }
    }
  });
  return found;
}

/**
 * The project's env example files. `forFile(path)` merges the ones in that
 * file's folder and every folder above it (a backend/ file is not checked
 * against frontend/.env.example), or returns null when there are none.
 */
export function documentedEnv(root, allFiles) {
  const examples = allFiles
    .filter((f) => ENV_EXAMPLE_FILE.test(f))
    .map((f) => ({ file: f, dir: f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "", ...parseExample(readText(root, f) ?? "") }));
  return {
    forFile(path) {
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const scoped = examples.filter((e) => e.dir === "" || dir === e.dir || dir.startsWith(`${e.dir}/`));
      if (scoped.length === 0) return null;
      const names = new Set(scoped.flatMap((e) => [...e.names]));
      const values = new Map(scoped.flatMap((e) => [...e.values]).reverse());
      return { files: scoped.map((e) => e.file), names, values };
    },
  };
}

function parseExample(text) {
  const names = new Set();
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(#?)\s*(?:export\s+)?([A-Za-z_]\w*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    names.add(m[2]);
    if (!m[1] && !values.has(m[2])) values.set(m[2], unquote(m[3].replace(/\s+#.*$/, "").trim()));
  }
  return { names, values };
}

function unquote(value) {
  return /^(["'])(.*)\1$/.exec(value)?.[2] ?? value;
}

/** Reads that need documenting: not provided by the platform, not justified on the line. */
export function undocumentedReads(file, content, documented) {
  const seen = new Set();
  return extractEnvReads(file, content).filter(({ name, text }) => {
    if (isProvided(name) || documented?.names.has(name) || /justified:/.test(text) || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
