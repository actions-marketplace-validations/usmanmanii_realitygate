import { DEFAULT_EXCLUDE } from "./config.mjs";
import { documentedEnv } from "./env.mjs";
import { SOURCE_EXT, CONFIG_TEXT_EXT, isTestFile, isSecretEnvFile, listFiles, readText } from "./files.mjs";
import { compileGlobs } from "./glob.mjs";
import { buildImportResolver } from "./imports.mjs";
import { buildGoResolver, buildPythonResolver } from "./langs.mjs";
import { LOCKFILE, MANIFEST, buildLockIndex } from "./lockfile.mjs";
import { FILE_RULES, LINE_RULES, MANIFEST_RULE_IDS, TEST_RULE_IDS } from "./rules.mjs";
import { isRealTestFile } from "./testquality.mjs";
import { buildUsageIndex, unwiredSkips } from "./unwired.mjs";

const MAX_LINE = 2000;
// The Go convention, also used by protoc, sqlc and others: a generated file says so at the top.
const GENERATED = /^\s*(?:\/\/|#|\/\*)\s*Code generated\b.*\bDO NOT EDIT\b/m;

/**
 * Resolves which files are "app source" for this project, and how many files
 * each include target matched. A target that matches nothing is reported, so
 * callers can fail instead of passing on an empty scan.
 */
export function selectSources(root, config, allFiles = listFiles(root)) {
  const excluded = compileGlobs([...DEFAULT_EXCLUDE, ...config.exclude]);
  const candidates = allFiles.filter(
    (f) => SOURCE_EXT.test(f) && !isTestFile(f) && !excluded(f) && !isSecretEnvFile(f),
  );

  if (config.include.length === 0) {
    return { files: candidates, targets: [{ glob: "(all source files)", count: candidates.length }], allFiles };
  }
  const targets = config.include.map((glob) => {
    const match = compileGlobs([glob]);
    return { glob, count: candidates.filter(match).length };
  });
  const inc = compileGlobs(config.include);
  return { files: candidates.filter(inc), targets, allFiles };
}

/**
 * Test files for the test-quality rules (R-019, R-020). `include` lists app
 * source, so it doesn't limit these; `exclude` does. Fixtures, mocks and
 * snapshots are data, not tests.
 */
export function selectTestFiles(config, allFiles) {
  const excluded = compileGlobs([...DEFAULT_EXCLUDE, ...config.exclude]);
  return allFiles.filter((f) => isRealTestFile(f) && !excluded(f) && !isSecretEnvFile(f));
}

/**
 * Runs R-021 over the dependency manifests. In change mode a changed lockfile
 * rechecks every manifest, since dropping an entry breaks an unchanged one.
 */
export function scanManifests(root, config, allFiles, onlyFiles) {
  const excluded = compileGlobs([...DEFAULT_EXCLUDE, ...config.exclude]);
  const lockChanged = onlyFiles && [...onlyFiles].some((f) => LOCKFILE.test(f));
  const files = allFiles.filter((f) => MANIFEST.test(f) && !excluded(f) && (!onlyFiles || lockChanged || onlyFiles.has(f)));
  return { files, findings: scanFiles(root, files, config, { allFiles, onlyRuleIds: MANIFEST_RULE_IDS }) };
}

/** Runs the test-quality rules over the project's test files. */
export function scanTestFiles(root, config, allFiles, onlyFiles) {
  const files = selectTestFiles(config, allFiles).filter((f) => !onlyFiles || onlyFiles.has(f));
  return { files, findings: scanFiles(root, files, config, { allFiles, onlyRuleIds: TEST_RULE_IDS }) };
}

/**
 * Everything the scan leaves out, with the reason and how many files it
 * removes, so a report never looks more complete than it is.
 */
export function exclusions(root, config, allFiles) {
  const code = allFiles.filter((f) => SOURCE_EXT.test(f) && !isSecretEnvFile(f));
  const builtIn = compileGlobs(DEFAULT_EXCLUDE);
  const configured = compileGlobs(config.exclude);
  const items = config.exclude.map((glob) => ({
    what: glob,
    reason: config.excludeReasons?.[glob] ?? "no reason given",
    files: code.filter(compileGlobs([glob])).length,
    configured: true,
  }));
  items.push({ what: "built-in: *.d.ts, *.config.*, seeds, migrations, generated/, protobuf output", reason: "not hand-written app code", files: code.filter(builtIn).length });
  const app = code.filter((f) => !isTestFile(f) && !builtIn(f) && !configured(f));
  const generated = app.filter((f) => GENERATED.test((readText(root, f) ?? "").slice(0, 2000))).length;
  if (generated) items.push({ what: 'files headed "Code generated … DO NOT EDIT"', reason: "generated code", files: generated });
  if (config.include.length) {
    const inc = compileGlobs(config.include);
    items.push({ what: "outside the include targets", reason: "include lists the app source to scan", files: app.filter((f) => !inc(f)).length });
  }
  items.push({ what: "test files", reason: "read only by R-019/R-020; fixtures, mocks and snapshots not at all", files: code.filter(isTestFile).length });
  for (const id of config.disable) items.push({ what: `rule ${id} disabled`, reason: config.disableReasons?.[id] ?? "no reason given", files: null, configured: true });
  // With no manifest there is nothing to check imports against, so R-014 is off for that language.
  if (!config.disable.includes("R-014")) {
    const scanned = config.include.length ? app.filter(compileGlobs(config.include)) : app;
    for (const [lang, ext, manifest, names] of [
      ["JS/TS", /\.[cm]?[jt]sx?$/, /(?:^|\/)package\.json$/, "package.json"],
      ["Python", /\.py$/, /(?:^|\/)(?:requirements[\w.-]*\.(?:txt|in)|requirements\/[\w.-]+\.(?:txt|in)|pyproject\.toml|Pipfile|setup\.py|setup\.cfg)$/, "requirements*.txt, pyproject.toml, Pipfile or setup.py"],
      ["Go", /\.go$/, /(?:^|\/)go\.(?:mod|work)$/, "go.mod"],
    ]) {
      const files = scanned.filter((f) => ext.test(f)).length;
      if (files && !allFiles.some((f) => manifest.test(f))) items.push({ what: `R-014 off for ${lang}`, reason: `no ${names} to check imports against`, files });
    }
  }
  if (!config.disable.includes("R-018")) {
    const scanned = config.include.length ? app.filter(compileGlobs(config.include)) : app;
    const s = unwiredSkips(root, allFiles, scanned);
    if (s.wildcard) items.push({ what: "R-018 off", reason: 'a package.json exports "./*", so any file is public and no export can be called unused', files: s.checked });
    else {
      if (s.entry) items.push({ what: "R-018 skips entry files", reason: "framework entry files, bin/, scripts/, hooks/, index/main/server/app files, stories and components/ui/ are loaded by location; see the README", files: s.entry });
      if (s.named) items.push({ what: "R-018 skips files named by config", reason: "package.json, HTML, YAML or a tool config names them by path", files: s.named });
      items.push({ what: "R-018 skips convention exports", reason: "names frameworks read by convention (GET, metadata, loader…), default exports and type exports; see the README", files: null });
    }
  }
  return items;
}

/**
 * Every justification comment in the given files, with its reason. Such a
 * comment silences R-006/7/8, R-017, R-018, R-019 (no assertion) and R-020 on
 * its line. The marker inside a string doesn't count.
 */
export function justifiedLines(root, files) {
  const out = [];
  for (const file of files) {
    const content = readText(root, file);
    if (content === null) continue;
    content.split(/\r?\n/).forEach((line, i) => {
      if (line.length > MAX_LINE || !line.includes("justified:")) return;
      const start = commentStart(line);
      if (start < 0) return;
      const at = line.indexOf("justified:", start);
      if (at < 0) return;
      const reason = line.slice(at + "justified:".length).split("*/")[0].trim();
      out.push({ file, line: i + 1, reason: reason || "(no reason)" });
    });
  }
  return out;
}

/** Where the line's comment starts (`//`, `#`, `/*`, or a `*` doc-comment line), ignoring markers inside strings; -1 if none. */
function commentStart(line) {
  if (/^\s*\*/.test(line)) return 0;
  for (const m of line.matchAll(/\/\/|#|\/\*/g)) if (!insideString(line, m.index)) return m.index;
  return -1;
}

function insideString(line, index) {
  let quote = null;
  for (let i = 0; i < index; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
  }
  return quote !== null;
}

/** Files outside app source that can still leak secrets (config files). */
export function selectSecretScanExtras(config, allFiles) {
  const excluded = compileGlobs(config.exclude);
  return allFiles.filter(
    (f) =>
      CONFIG_TEXT_EXT.test(f) &&
      !excluded(f) &&
      !/(?:^|\/)(?:package-lock|npm-shrinkwrap|composer\.lock|Pipfile\.lock|poetry\.lock)\.json$|(?:^|\/)pnpm-lock\.yaml$|(?:^|\/)yarn\.lock$/.test(f),
  );
}

export function activeRules(config) {
  const disabled = new Set(config.disable);
  const lineRules = [...LINE_RULES, ...config.rules].filter((r) => !disabled.has(r.id));
  const fileRules = [...FILE_RULES, ...config.fileRules.map(customFileRule)].filter((r) => !disabled.has(r.id));
  return { lineRules, fileRules };
}

function customFileRule(rule) {
  return {
    id: rule.id,
    label: rule.label,
    paths: rule.paths,
    custom: true,
    check(_file, content) {
      if (!rule.trigger.test(content) || rule.mustContain.test(content)) return [];
      const idx = content.search(rule.trigger);
      return [{ line: content.slice(0, idx).split("\n").length, text: `matches ${rule.trigger} without ${rule.mustContain}` }];
    },
  };
}

/** Runs every active rule over the given files. Returns findings sorted by file/line. */
export function scanFiles(root, files, config, { allFiles, onlyRuleIds } = {}) {
  const { lineRules, fileRules } = activeRules(config);
  // Manifest rules (R-021) run only when asked for by id, so setup.py isn't judged twice.
  const keep = (r) => (onlyRuleIds ? onlyRuleIds.has(r.id) : !r.manifests);
  const lr = lineRules.filter(keep).map((r) => ({ ...r, pathMatch: r.paths ? compileGlobs(r.paths) : null }));
  const fr = fileRules.filter(keep).map((r) => ({ ...r, pathMatch: r.paths ? compileGlobs(r.paths) : null }));
  let usage = null;
  let python = null;
  let go = null;
  let locks = null;
  const ctx = {
    get locks() {
      return (locks ??= buildLockIndex(root, allFiles ?? files));
    },
    get python() {
      return (python ??= buildPythonResolver(root, allFiles ?? files));
    },
    get go() {
      return (go ??= buildGoResolver(root, allFiles ?? files));
    },
    resolver: buildImportResolver(root, allFiles ?? files),
    env: documentedEnv(root, allFiles ?? files),
    get usage() {
      return (usage ??= buildUsageIndex(root, allFiles ?? files));
    },
  };
  const findings = [];

  for (const file of files) {
    const content = readText(root, file);
    if (content === null || GENERATED.test(content.slice(0, 2000))) continue;
    const lines = content.split(/\r?\n/);

    for (const rule of lr) {
      if (rule.exts && !rule.exts.test(file)) continue;
      if (rule.pathMatch && !rule.pathMatch(file)) continue;
      if (rule.skipPaths && rule.skipPaths.test(file)) continue;
      lines.forEach((line, i) => {
        if (line.length > MAX_LINE) return;
        const m = rule.re.exec(line);
        if (!m) return;
        if (rule.justifiable && /justified:/.test(line)) return;
        if (rule.skipInRegexLiteral && insideRegexLiteral(line, m.index)) return;
        findings.push(finding(rule, file, i + 1, line));
      });
    }
    for (const rule of fr) {
      if (rule.exts && !rule.exts.test(file)) continue;
      if (Boolean(rule.tests) !== isRealTestFile(file)) continue;
      if (rule.pathMatch && !rule.pathMatch(file)) continue;
      for (const hit of rule.check(file, content, ctx)) {
        findings.push(finding(rule, file, hit.line, hit.text, hit.severity));
      }
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return findings;
}

/**
 * True when `index` falls inside a JS regex literal on this line. Lint rules
 * and other gates define the forbidden words as regexes; that is a definition,
 * not a placeholder, so the fake-code rules skip it.
 */
export function insideRegexLiteral(line, index) {
  const literal = /(^|[=(,:[!&|?{};]|return|\s)\s*\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/[dgimsuyv]*/g;
  for (const m of line.matchAll(literal)) {
    const start = m.index + m[0].indexOf("/", m[1].length);
    const end = m.index + m[0].length;
    if (index >= start && index < end) return true;
  }
  return false;
}

/** A rule can lower one hit to a warning, as R-021 does when there's no lockfile to check against. */
function finding(rule, file, line, text, severity) {
  return {
    rule: rule.id,
    label: rule.label,
    severity: severity ?? rule.severity ?? "error",
    custom: Boolean(rule.custom),
    file,
    line,
    text: String(text).trim().slice(0, 160),
  };
}
