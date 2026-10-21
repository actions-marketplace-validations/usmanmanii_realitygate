import { loadConfig } from "./config.mjs";
import { posix } from "node:path";
import { ENV_EXAMPLE_FILE, documentedEnv } from "./env.mjs";
import { MANIFEST } from "./lockfile.mjs";
import { listFiles } from "./files.mjs";
import { compileGlobs } from "./glob.mjs";
import { exclusions, justifiedLines, scanFiles, scanManifests, scanTestFiles, selectSecretScanExtras, selectSources } from "./scan.mjs";
import { exclusionLines } from "./report.mjs";
import { c, out } from "./ui.mjs";

/**
 * The Reality Gate. Fails on any error-severity finding, and on any include
 * target that matched zero files (unless listed in mayBeEmpty with a reason):
 * a scan of nothing is a broken gate, not a clean one.
 */
export function runCheck(root, { configPath, onlyFiles, deleted } = {}) {
  const config = loadConfig(root, configPath);
  const allFiles = listFiles(root);
  const selected = selectSources(root, config, allFiles);
  const { targets } = selected;
  // Change mode: the same rules, scope checks and project context, applied to the changed files only.
  const files = onlyFiles ? selected.files.filter((f) => onlyFiles.has(f)) : selected.files;
  const emptyAllowed = compileGlobs(Object.keys(config.mayBeEmpty));

  const scanErrors = [];
  for (const t of targets) {
    if (t.count > 0) continue;
    if (config.mayBeEmpty[t.glob] || emptyAllowed(t.glob)) {
      t.allowedEmpty = config.mayBeEmpty[t.glob] ?? "listed in mayBeEmpty";
      continue;
    }
    scanErrors.push(`include target "${t.glob}" matched 0 files — a gate that scans nothing passes nothing`);
  }

  const findings = scanFiles(root, files, config, { allFiles });
  const extras = selectSecretScanExtras(config, allFiles).filter((f) => !selected.files.includes(f) && (!onlyFiles || onlyFiles.has(f)));
  findings.push(...scanFiles(root, extras, config, { allFiles, onlyRuleIds: new Set(["R-011", "R-012"]) }));
  const tests = scanTestFiles(root, config, allFiles, onlyFiles);
  findings.push(...tests.findings);
  const manifests = scanManifests(root, config, allFiles, onlyFiles);
  findings.push(...manifests.findings);

  // A changed manifest or env example can break files the change never touched: an import of a
  // removed dependency (R-014), a read of a var dropped from .env.example (R-017). Recheck those
  // rules on every unchanged file.
  const widened = [];
  if (onlyFiles) {
    // A deleted manifest or env example doesn't break a check, it switches one off. Say so.
    const gone = [...(deleted ?? [])].filter((f) => MANIFEST.test(f) || ENV_EXAMPLE_FILE.test(f));
    const env = gone.some((f) => ENV_EXAMPLE_FILE.test(f)) ? documentedEnv(root, allFiles) : null;
    for (const f of gone) {
      const dir = posix.dirname(f) === "." ? "" : `${posix.dirname(f)}/`;
      const under = selected.files.filter((s) => s.startsWith(dir));
      const text = ENV_EXAMPLE_FILE.test(f)
        ? `deleted in this change: ${under.filter((s) => !env.forFile(s)).length} source file(s) under ${dir || "the root"} now have no env example, so R-017 no longer checks the vars they read`
        : `deleted in this change: imports in ${under.length} source file(s) under ${dir || "the root"} are checked only if another manifest still covers them (R-014), and its dependencies are no longer checked against a lockfile (R-021)`;
      const rule = ENV_EXAMPLE_FILE.test(f) ? "R-017" : "R-014";
      findings.push({ rule, label: "check switched off: its source file was deleted", severity: "warn", custom: false, file: f, line: 1, text });
    }
    const changed = [...onlyFiles, ...gone];
    const rules = new Set();
    const because = changed.filter((f) => {
      const manifest = MANIFEST.test(f);
      const example = ENV_EXAMPLE_FILE.test(f);
      if (manifest) rules.add("R-014");
      if (example) rules.add("R-017");
      return manifest || example;
    });
    if (rules.size) {
      const unchanged = selected.files.filter((f) => !onlyFiles.has(f));
      findings.push(...scanFiles(root, unchanged, config, { allFiles, onlyRuleIds: rules }));
      widened.push({ because, rules: [...rules].sort(), files: unchanged.length });
    }
  }

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity !== "error");
  return {
    ok: errors.length === 0 && scanErrors.length === 0,
    filesScanned: files.length,
    testFilesScanned: tests.files.length,
    manifestsScanned: manifests.files.length,
    excluded: exclusions(root, config, allFiles),
    justified: justifiedLines(root, [...files, ...tests.files]),
    changedOnly: Boolean(onlyFiles),
    widened,
    targets,
    scanErrors,
    errors,
    warnings,
  };
}

export function printCheck(result) {
  out(c.bold("realitygate check — Reality Gate"));
  for (const t of result.targets) {
    const note = t.allowedEmpty ? c.dim(` (allowed empty: ${t.allowedEmpty})`) : "";
    out(`  scanned ${String(t.count).padStart(5)}  ${t.glob}${note}`);
  }
  out(`  scanned ${String(result.testFilesScanned).padStart(5)}  test files (R-019, R-020 only)`);
  out(`  scanned ${String(result.manifestsScanned).padStart(5)}  dependency manifests (R-021 only)`);
  for (const line of exclusionLines(result.excluded)) out(c.dim(line));
  if (result.justified.length) out(c.dim(`  justified: ${result.justified.length} line(s) silence a rule with \`justified:\` (listed by \`realitygate audit\`)`));
  for (const e of result.scanErrors) out(c.red(`  ✗ SCAN  ${e}`));
  for (const f of [...result.errors, ...result.warnings]) {
    const tag = f.severity === "error" ? c.red("✗") : c.yellow("!");
    out(`  ${tag} ${f.file}:${f.line}  ${c.bold(f.rule)} ${f.label}`);
    out(c.dim(`      ${f.text}`));
  }
  if (result.changedOnly) {
    const w = result.widened[0];
    const unchanged = w ? `; ${w.because.join(", ")} changed, so ${w.rules.join(" and ")} also rechecked ${w.files} unchanged file(s)` : "; unchanged files were not scanned";
    out(c.dim(`  change mode: checked ${result.filesScanned} changed source file(s)${result.base ? ` since ${result.base}` : ""}${unchanged}`));
  }
  if (result.ok) {
    const warn = result.warnings.length ? c.yellow(` (${result.warnings.length} warning(s))`) : "";
    out(c.green(`reality-check: clean — ${result.filesScanned} ${result.changedOnly ? "changed " : ""}files`) + warn);
  } else {
    out(
      c.red(
        `\n${result.errors.length + result.scanErrors.length} reality violation(s). ` +
          "Implement it for real, add `justified: <reason>` where the rule allows it, or mark the task BLOCKED.",
      ),
    );
  }
}
