import { DEFAULT_EXCLUDE } from "./config.mjs";
import { SOURCE_EXT, CONFIG_TEXT_EXT, isTestFile, isSecretEnvFile, listFiles, readText } from "./files.mjs";
import { compileGlobs } from "./glob.mjs";
import { buildImportResolver } from "./imports.mjs";
import { FILE_RULES, LINE_RULES } from "./rules.mjs";

const MAX_LINE = 2000;

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
  const keep = (r) => !onlyRuleIds || onlyRuleIds.has(r.id);
  const lr = lineRules.filter(keep).map((r) => ({ ...r, pathMatch: r.paths ? compileGlobs(r.paths) : null }));
  const fr = fileRules.filter(keep).map((r) => ({ ...r, pathMatch: r.paths ? compileGlobs(r.paths) : null }));
  const ctx = { resolver: buildImportResolver(root, allFiles ?? files) };
  const findings = [];

  for (const file of files) {
    const content = readText(root, file);
    if (content === null) continue;
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
      if (rule.pathMatch && !rule.pathMatch(file)) continue;
      for (const hit of rule.check(file, content, ctx)) {
        findings.push(finding(rule, file, hit.line, hit.text));
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

function finding(rule, file, line, text) {
  return {
    rule: rule.id,
    label: rule.label,
    severity: rule.severity ?? "error",
    custom: Boolean(rule.custom),
    file,
    line,
    text: String(text).trim().slice(0, 160),
  };
}
