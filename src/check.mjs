import { loadConfig } from "./config.mjs";
import { listFiles } from "./files.mjs";
import { compileGlobs } from "./glob.mjs";
import { scanFiles, selectSecretScanExtras, selectSources } from "./scan.mjs";
import { c, out } from "./ui.mjs";

/**
 * The Reality Gate. Fails on any error-severity finding, and on any include
 * target that matched zero files (unless listed in mayBeEmpty with a reason):
 * a scan of nothing is a broken gate, not a clean one.
 */
export function runCheck(root, { configPath } = {}) {
  const config = loadConfig(root, configPath);
  const allFiles = listFiles(root);
  const { files, targets } = selectSources(root, config, allFiles);
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
  const extras = selectSecretScanExtras(config, allFiles).filter((f) => !files.includes(f));
  findings.push(...scanFiles(root, extras, config, { allFiles, onlyRuleIds: new Set(["R-011", "R-012"]) }));

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity !== "error");
  return {
    ok: errors.length === 0 && scanErrors.length === 0,
    filesScanned: files.length,
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
  for (const e of result.scanErrors) out(c.red(`  ✗ SCAN  ${e}`));
  for (const f of [...result.errors, ...result.warnings]) {
    const tag = f.severity === "error" ? c.red("✗") : c.yellow("!");
    out(`  ${tag} ${f.file}:${f.line}  ${c.bold(f.rule)} ${f.label}`);
    out(c.dim(`      ${f.text}`));
  }
  if (result.ok) {
    const warn = result.warnings.length ? c.yellow(` (${result.warnings.length} warning(s))`) : "";
    out(c.green(`reality-check: clean — ${result.filesScanned} files`) + warn);
  } else {
    out(
      c.red(
        `\n${result.errors.length + result.scanErrors.length} reality violation(s). ` +
          "Implement it for real, add `justified: <reason>` where the rule allows it, or mark the task BLOCKED.",
      ),
    );
  }
}
