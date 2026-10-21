// Unwired code: named exports that nothing outside their own file mentions.
// Deliberately conservative, because a false positive is a bug: any mention
// of the name anywhere (code, HTML, JSON, comments, strings) counts as use,
// and files that frameworks or package.json run by convention are skipped.

import { isTestFile, readText } from "./files.mjs";

const REFERENCE_EXT = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|mdx?|html?|json|ya?ml|toml)$/;
const CONFIG_EXT = /\.(?:json|html?|ya?ml|toml)$|(?:^|\/)[^/]*\.config\.[cm]?[jt]s$/;

// Files a framework, runtime or tool loads by location, never by import.
const ENTRY_FILE = new RegExp(
  [
    String.raw`(?:^|/)(?:src/)?app/(?:.*/)?(?:page|layout|template|loading|error|global-error|not-found|forbidden|unauthorized|default|route|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.[cm]?[jt]sx?$`,
    String.raw`(?:^|/)(?:src/)?(?:middleware|instrumentation(?:-client)?|proxy)\.[cm]?[jt]s$`,
    String.raw`(?:^|/)pages/`,
    String.raw`(?:^|/)app/routes/|(?:^|/)app/(?:root|entry\.client|entry\.server)\.[cm]?[jt]sx?$`,
    String.raw`(?:^|/)\+[\w.-]+\.[cm]?[jt]s$|(?:^|/)hooks\.(?:server|client)\.[cm]?[jt]s$`,
    String.raw`(?:^|/)(?:bin|scripts|hooks|cli)/`,
    String.raw`(?:^|/)(?:src/)?(?:index|main|server|app|worker|sw|service-worker)\.[cm]?[jt]sx?$`,
    String.raw`\.(?:stories|story|worker)\.[cm]?[jt]sx?$`,
    // UI kits copied in whole (shadcn/ui and similar): unused primitives are expected.
    String.raw`(?:^|/)components/ui/`,
  ].join("|"),
);

// Export names frameworks read by convention.
const CONVENTION_NAMES = new Set([
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "metadata", "generateMetadata",
  "generateStaticParams", "generateViewport", "generateSitemaps", "generateImageMetadata", "viewport",
  "revalidate", "dynamic", "dynamicParams", "runtime", "preferredRegion", "maxDuration", "fetchCache",
  "experimental_ppr", "config", "getServerSideProps", "getStaticProps", "getStaticPaths",
  "getInitialProps", "loader", "action", "clientLoader", "clientAction", "meta", "links", "headers",
  "handle", "shouldRevalidate", "ErrorBoundary", "HydrateFallback", "Layout", "prerender", "load",
  "entries", "handler", "middleware", "register", "onRequestError", "alt", "size", "contentType",
]);

const INLINE_EXPORT = /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+|abstract\s+class\s+)([A-Za-z_$][\w$]*)/;
const LIST_EXPORT = /^\s*export\s*\{([^}]*)\}\s*;?\s*$/;
const IDENT = /[A-Za-z_$][\w$]*/g;

/**
 * One pass over the project: in how many non-test files each identifier
 * appears, which identifiers appear in tests, and the text of the files that
 * can name an entry point by path (package.json, HTML, YAML, tool configs).
 */
export function buildUsageIndex(root, allFiles) {
  const appFiles = new Map();
  const inTests = new Set();
  let configText = "";
  let wildcardExports = false;
  for (const f of allFiles) {
    if (!REFERENCE_EXT.test(f)) continue;
    const text = readText(root, f);
    if (text === null) continue;
    const ids = new Set(text.match(IDENT) ?? []);
    if (isTestFile(f)) {
      ids.forEach((id) => inTests.add(id));
      continue;
    }
    for (const id of ids) appFiles.set(id, (appFiles.get(id) ?? 0) + 1);
    if (CONFIG_EXT.test(f)) configText += `\n${text}`;
    if (/(?:^|\/)package\.json$/.test(f) && /"\.\/[^"]*\*[^"]*"\s*:/.test(text)) wildcardExports = true;
  }
  return {
    // A package that exports "./*" lets consumers import any file, so no export can be called unused.
    disabled: wildcardExports,
    usedElsewhere: (name, ownContent) => (appFiles.get(name) ?? 0) - (new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`).test(ownContent) ? 1 : 0) > 0,
    usedInTests: (name) => inTests.has(name),
    namedByConfig: (file) => namedIn(configText, file),
  };
}

/**
 * How many of `files` R-018 skips whole, and why: framework entry files by
 * location, and files that package.json, HTML, YAML or a tool config names by
 * path. Reads only those config files, not the whole project.
 */
export function unwiredSkips(root, allFiles, files) {
  let configText = "";
  let wildcard = false;
  for (const f of allFiles) {
    if (isTestFile(f) || !CONFIG_EXT.test(f)) continue;
    const text = readText(root, f) ?? "";
    configText += `\n${text}`;
    if (/(?:^|\/)package\.json$/.test(f) && /"\.\/[^"]*\*[^"]*"\s*:/.test(text)) wildcard = true;
  }
  const js = files.filter((f) => /\.[cm]?[jt]sx?$/.test(f));
  const entry = js.filter((f) => ENTRY_FILE.test(f));
  const named = js.filter((f) => !ENTRY_FILE.test(f) && namedIn(configText, f));
  return { checked: js.length, entry: entry.length, named: named.length, wildcard };
}

function namedIn(configText, file) {
  const noExt = file.replace(/\.[^./]+$/, "");
  return configText.includes(file) || configText.includes(`${noExt}"`) || configText.includes(`${noExt}'`);
}

/** Named exports in `file` that nothing else in the project mentions. */
export function unwiredExports(file, content, index) {
  if (index.disabled || ENTRY_FILE.test(file) || index.namedByConfig(file)) return [];
  const lines = content.split(/\r?\n/);
  const out = [];
  lines.forEach((line, i) => {
    if (/justified:/.test(line)) return;
    const names = [];
    const inline = INLINE_EXPORT.exec(line);
    if (inline) names.push({ name: inline[1], local: inline[1], minOwn: 2 });
    const list = LIST_EXPORT.exec(line);
    if (list) {
      for (const part of list[1].split(",")) {
        const m = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
        if (m && !/^\s*type\s/.test(part) && m[2] !== "default") names.push({ name: m[2] ?? m[1], local: m[1], minOwn: 3 });
      }
    }
    for (const { name, local, minOwn } of names) {
      if (CONVENTION_NAMES.has(name)) continue;
      const ownUses = (content.match(new RegExp(`(?<![\\w$])${escape(local)}(?![\\w$])`, "g")) ?? []).length;
      if (ownUses >= minOwn) continue;
      if (index.usedElsewhere(name, content)) continue;
      out.push({ line: i + 1, text: index.usedInTests(name) ? `\`${name}\` is exported but only tests use it` : `\`${name}\` is exported but nothing imports or calls it` });
    }
  });
  return out;
}

const escape = (s) => s.replace(/[$]/g, "\\$");
