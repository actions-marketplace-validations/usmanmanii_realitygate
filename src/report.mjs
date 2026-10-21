import { c, out } from "./ui.mjs";

const gradeColor = (g) => ({ A: c.green, B: c.green, C: c.yellow, D: c.yellow, F: c.red })[g] ?? c.bold;
const STATUS_MARK = { PASS: "✓", FAIL: "✗", "NOT RUN": "–" };

/** One-line summary of the executed checks, e.g. "2 passed · 1 not run". */
export function executedSummary(checks = []) {
  const n = (s) => checks.filter((ch) => ch.status === s).length;
  const parts = [];
  if (n("PASS")) parts.push(`${n("PASS")} passed`);
  if (n("FAIL")) parts.push(`${n("FAIL")} failed`);
  if (n("NOT RUN")) parts.push(`${n("NOT RUN")} not run`);
  return parts.join(" · ") || "none";
}

/** The "not scanned" lines shared by check and audit. Built-in entries that remove no files are left out; configured ones never are. */
export function exclusionLines(excluded = []) {
  return excluded
    .filter((e) => e.configured || e.files !== 0)
    .map((e) => `  excluded ${e.files === null ? "     " : String(e.files).padStart(5)}  ${e.what} (${e.reason})`);
}

function checkLine(ch) {
  const how = ch.command ? `\`${ch.command}\`${ch.exitCode !== undefined ? ` → exit ${ch.exitCode ?? "none"}` : ""}` : "";
  return { how, kind: ch.kind === "recorded" ? "recorded" : "executed" };
}

export function bootLine(r) {
  const tag = r.status === "PASS" ? c.green("PASS") : r.status === "FAIL" ? c.red("FAIL") : c.yellow("NOT RUN");
  const lines = [];
  for (const s of r.steps ?? []) lines.push(c.dim(`  $ ${s.command}  → exit ${s.exitCode ?? "none (stopped)"}`));
  if (r.envPassed) lines.push(c.dim(`  env passed to the app: ${r.envPassed.length ? r.envPassed.join(", ") : "(none documented)"}`));
  lines.push(`  ${tag}  ${r.detail}`);
  return lines;
}

export function printAudit(r, { limit = 20 } = {}) {
  const color = gradeColor(r.grade);
  out();
  out(`${c.bold(`REALITY AUDIT — ${r.project}`)}    Reality Score: ${color(c.bold(`${r.score}/100 (${r.grade})`))}`);
  out(c.dim(`scanned ${r.stats.sourceFiles} source files · ${r.stats.testFiles} test files (${r.stats.testFilesWithAssertions} with assertions) · score from static analysis only`));
  if (r.delta) out(deltaLine(r.delta));
  out();
  out(c.bold("Inferred (static: code was read, not run)"));
  out(c.bold("  Category                 Score    Issues"));
  for (const cat of r.categories) {
    const s = `${cat.score}/${cat.weight}`;
    const mark = cat.score === cat.weight ? c.green("✓") : cat.score <= cat.weight / 2 ? c.red("✗") : c.yellow("!");
    out(`  ${mark} ${cat.name.padEnd(22)} ${s.padStart(7)}    ${cat.items.length}`);
  }

  if (r.checks) {
    out();
    out(c.bold(`Executed (${executedSummary(r.checks)}) — not part of the score`));
    for (const ch of r.checks) {
      const mark = ch.status === "PASS" ? c.green(STATUS_MARK.PASS) : ch.status === "FAIL" ? c.red(STATUS_MARK.FAIL) : c.yellow(STATUS_MARK["NOT RUN"]);
      const { how, kind } = checkLine(ch);
      out(`  ${mark} ${ch.name.padEnd(32)} ${ch.status.padEnd(8)} ${c.dim(kind === "recorded" ? "recorded" : how)}`);
      out(c.dim(`      ${ch.detail}`));
    }
  }

  out();
  out(c.bold("Not scanned"));
  for (const line of exclusionLines(r.excluded)) out(c.dim(line));
  if (r.justified?.length) {
    out();
    out(c.bold(`Justified (${r.justified.length} line(s) where \`justified:\` silences a rule${r.justified.length > limit ? ` — ${limit} shown, use --md for all` : ""})`));
    for (const j of r.justified.slice(0, limit)) out(`  ${c.yellow("~")} ${j.file}:${j.line}  ${c.dim(j.reason)}`);
  }

  const signalLines = r.signals.issues.map((s) => `  ${c.red("✗")} ${s.reason}`);
  if (signalLines.length) {
    out();
    out(c.bold("Project checks"));
    signalLines.forEach((l) => out(l));
  }

  const errors = r.findings.filter((f) => f.severity === "error");
  if (errors.length) {
    out();
    out(c.bold(`Findings (${Math.min(limit, errors.length)} of ${errors.length}${errors.length > limit ? " — use --md for the full report" : ""})`));
    for (const f of errors.slice(0, limit)) {
      out(`  ${c.red("✗")} ${f.file}:${f.line}  ${c.bold(f.rule)} ${f.label}`);
      out(c.dim(`      ${f.text}`));
    }
  }

  out();
  out(c.bold("Fix plan"));
  r.fixPlan.forEach((step, i) => out(`  ${i + 1}. ${step}`));
  out();
  out(c.dim("Badge for your README:"));
  out(`  ${r.badge}`);
  out();
}

function deltaLine(d) {
  const sign = d.change > 0 ? `+${d.change}` : String(d.change);
  const color = d.change > 0 ? c.green : d.change < 0 ? c.red : c.dim;
  return color(`vs ${d.base}: ${d.baseScore} → ${d.score} (${sign}) · ${d.newFindings.length} new finding(s) · ${d.fixedFindings.length} fixed`);
}

export function auditMarkdown(r) {
  const lines = [];
  lines.push(`# Reality Audit — ${r.project}`);
  lines.push("");
  lines.push(`${r.badge}`);
  lines.push("");
  lines.push(`**Reality Score: ${r.score}/100 (${r.grade})** · ${r.stats.sourceFiles} source files · ${r.stats.testFiles} test files (${r.stats.testFilesWithAssertions} with assertions)`);
  lines.push("");
  lines.push("The score comes from static analysis: the code was read, not run. What was actually executed is listed separately and does not change the score.");
  lines.push("");
  if (r.delta) {
    const d = r.delta;
    const change = d.change == null ? "no score there" : `${d.baseScore} → ${d.score} (${d.change > 0 ? "+" : ""}${d.change})`;
    lines.push(`**Compared with \`${d.base}\`:** ${change} · ${d.newFindings.length} new finding(s) · ${d.fixedFindings.length} fixed`);
    lines.push("");
  }
  lines.push("## Inferred (static)");
  lines.push("");
  lines.push("| Category | Score | Issues |");
  lines.push("|---|---|---|");
  for (const cat of r.categories) lines.push(`| ${cat.name} | ${cat.score}/${cat.weight} | ${cat.items.length} |`);
  lines.push("");
  if (r.checks) {
    lines.push(`## Executed (${executedSummary(r.checks)})`);
    lines.push("");
    lines.push("| Check | Status | How | Detail |");
    lines.push("|---|---|---|---|");
    for (const ch of r.checks) {
      const { how, kind } = checkLine(ch);
      lines.push(`| ${ch.name} | ${STATUS_MARK[ch.status] ?? ""} ${ch.status} | ${kind === "recorded" ? "recorded in journals" : how || "—"} | ${cell(ch.detail)} |`);
    }
    lines.push("");
  }
  if (r.signals.issues.length) {
    lines.push("## Project checks");
    lines.push("");
    for (const s of r.signals.issues) lines.push(`- ✗ ${s.reason}`);
    lines.push("");
  }
  lines.push("## Fix plan");
  lines.push("");
  r.fixPlan.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  lines.push("");
  const excluded = (r.excluded ?? []).filter((e) => e.configured || e.files !== 0);
  if (excluded.length) {
    lines.push("## Not scanned");
    lines.push("");
    lines.push("| What | Files | Reason |");
    lines.push("|---|---|---|");
    for (const e of excluded) lines.push(`| ${cell(e.what)} | ${e.files ?? "—"} | ${cell(e.reason)} |`);
    lines.push("");
  }
  if (r.justified?.length) {
    lines.push(`## Justified (${r.justified.length})`);
    lines.push("");
    lines.push("Lines where a `justified:` comment silences a rule. Each reason is the author's claim; review them.");
    lines.push("");
    lines.push("| Location | Reason |");
    lines.push("|---|---|");
    for (const j of r.justified) lines.push(`| \`${j.file}:${j.line}\` | ${cell(j.reason)} |`);
    lines.push("");
  }
  if (r.findings.length) {
    lines.push("## All findings");
    lines.push("");
    lines.push("| Severity | Rule | Location | Detail |");
    lines.push("|---|---|---|---|");
    for (const f of r.findings) {
      lines.push(`| ${f.severity} | ${f.rule} ${f.label} | \`${f.file}:${f.line}\` | ${cell(f.text)} |`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("Generated by `realitygate audit`. Scores are heuristic: they flag what to look at, not what is proven broken. A check marked NOT RUN was not run; it is not a pass.");
  lines.push("");
  return lines.join("\n");
}

export const PR_COMMENT_MARKER = "<!-- realitygate-pr-comment -->";

/** Short pull-request comment: score, delta against the base, executed checks, new findings. */
export function prCommentMarkdown(r, { maxFindings = 15 } = {}) {
  const d = r.delta;
  const lines = [PR_COMMENT_MARKER];
  let head = `### RealityGate: Reality Score ${r.score}/100 (${r.grade})`;
  if (d?.change != null) head += ` ${d.change > 0 ? "▲" : d.change < 0 ? "▼" : "="} ${d.change > 0 ? "+" : ""}${d.change} vs \`${d.base}\` (${d.baseScore})`;
  else if (d) head += ` · no score for \`${d.base}\` (nothing to audit there)`;
  lines.push(head, "");
  lines.push(`Score from static analysis (code read, not run). Executed: ${executedSummary(r.checks)}.`);
  const notRun = (r.checks ?? []).filter((ch) => ch.status !== "PASS");
  for (const ch of notRun) lines.push(`- ${STATUS_MARK[ch.status] ?? ""} **${ch.name}**: ${ch.status}${ch.command ? ` (\`${ch.command}\` → exit ${ch.exitCode ?? "none"})` : ""}`);
  lines.push("");
  if (d) {
    const errors = d.newFindings.filter((f) => f.severity === "error");
    lines.push(`**${d.newFindings.length} new finding(s)** (${errors.length} fail the gate) · **${d.fixedFindings.length} fixed**`);
    if (d.newFindings.length) {
      lines.push("", "| Rule | Location | Detail |", "|---|---|---|");
      for (const f of d.newFindings.slice(0, maxFindings)) lines.push(`| ${f.severity === "error" ? "✗" : "!"} ${f.rule} ${f.label} | \`${f.file}:${f.line}\` | ${cell(f.text)} |`);
      if (d.newFindings.length > maxFindings) lines.push("", `…and ${d.newFindings.length - maxFindings} more in the job summary.`);
    }
  } else {
    lines.push(`${r.findings.length} finding(s); see the job summary for the full report.`);
  }
  const justified = r.justified?.length ?? 0;
  const justifiedChange = d?.baseJustified != null && justified !== d.baseJustified ? ` (${justified > d.baseJustified ? "+" : ""}${justified - d.baseJustified} vs \`${d.base}\`)` : "";
  if (justified || justifiedChange) lines.push("", `**${justified} line(s) silenced with \`justified:\`**${justifiedChange}; the job summary lists each reason.`);
  lines.push("", "<sub>Generated by RealityGate. A check marked NOT RUN was not run; it is not a pass.</sub>", "");
  return lines.join("\n");
}

const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/`/g, "'").replace(/\r?\n/g, " ");
