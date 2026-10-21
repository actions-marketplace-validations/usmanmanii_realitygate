#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { installAgents, installGitHook } from "../src/agents.mjs";
import { runAudit } from "../src/audit.mjs";
import { auditAtRef, auditDelta, changedFiles, deletedFiles } from "../src/compare.mjs";
import { auditMarkdown, bootLine, printAudit, prCommentMarkdown } from "../src/report.mjs";
import { printCheck, runCheck } from "../src/check.mjs";
import { ConfigError, loadConfig } from "../src/config.mjs";
import { runDoctor } from "../src/doctor.mjs";
import { installHooks } from "../src/hooks-install.mjs";
import { KIT_ROOT, runInit } from "../src/init.mjs";
import { serveStdio } from "../src/mcp.mjs";
import { proofMarkdown, runProof } from "../src/proof.mjs";
import { buildReviewPack } from "../src/review-pack.mjs";
import { executedChecks, runBoot } from "../src/run.mjs";
import { runSelftest } from "../src/selftest.mjs";
import { scanSkills } from "../src/skill-scan.mjs";
import { c, err, out } from "../src/ui.mjs";

const HELP = `
${c.bold("realitygate")} — prove what your AI agent built is real.

${c.bold("Usage")}
  realitygate audit [dir] [--md[=file]] [--json] [--min-score N] [--all] [--exec]
                    [--compare <ref>] [--pr-comment=<file>]
      Reality Score (0–100) for any repo: fake code, hallucinated imports,
      exposed secrets, unvalidated routes, swallowed errors, tests. The score
      is static (read, not run). The report lists separately what was
      executed: the rule self-test always; with --exec also your test
      command and a clean-install boot. Anything not run says NOT RUN.
      --compare scores <ref> too and reports the delta and new findings;
      --pr-comment writes a short Markdown summary for a pull request.
  realitygate boot [dir] [--start "<cmd>"] [--install "<cmd>"] [--ready <regex>]
                   [--probe "<cmd>"] [--timeout <s>] [--json]
      Copy the project without node_modules or .env files, install from the
      lockfile, and start it with only the env vars in .env.example. Exit 1
      if install fails, the app crashes, or it never becomes ready.
  realitygate check [dir] [--config file] [--json] [--changed [--base <ref>]]
      The Reality Gate. Exit 1 on any violation or on a scan of zero files.
      With --changed (change mode), only files changed since <ref> (default
      HEAD: uncommitted work), so an existing repo can gate new work first.
      A changed manifest or .env.example also rechecks R-014/R-017 everywhere.
  realitygate selftest [dir] [--gate "<command>"]
      Proves every rule fires on a planted violation. With --gate, plants a
      canary in the project and requires your gate command to go red.
  realitygate init [dir] [--srs <file>] [--force]
      Copy BUILD-OS.md, START-HERE.md, docs/IDEA.md, the Build OS subagents
      (.claude/agents/) and a config into a project. With --srs, also copy your
      SRS or requirements document into docs/input/.
  realitygate hooks install [dir] [--git]
      Install Claude Code guardrail hooks (secrets, destructive git, allowlist,
      protected/applied-migration files) into .claude/. With --git, install a
      git pre-commit gate instead, which works with every agent.
  realitygate agents install [dir]
      Set up Codex, Antigravity/Gemini CLI, Cursor and GitHub Copilot: portable
      skills in .agents/skills/, plus AGENTS.md, GEMINI.md, .cursor/rules and
      .github/copilot-instructions.md blocks (existing content is kept).
  realitygate proof [dir] [--md[=file]] [--json] [--strict]
      Proof Ledger: which DONE tasks carry real evidence (failing tests first,
      green gate, APPROVED review, real execution, existing commit).
  realitygate review-pack <task-spec.md> [--base <git-ref>]
      Bundle reviewer instructions + spec + diff for a reviewer from a
      different model family. Writes .agent/review/<task>.md.
  realitygate scan-skills [dir] [--json] [--strict]
      Red-flag scan of any skill or plugin BEFORE you install it: remote code
      execution, obfuscation, hidden Unicode, credential/.env access,
      data-leak endpoints, prompt injection, permission bypass, hooks, MCP
      servers, install scripts. Reads files only; never runs them.
  realitygate mcp
      Read-only MCP server on stdio (tools: audit, check, proof, scan_skills,
      list_rules). Add it to Claude Code with:
      claude mcp add realitygate -- npx -y realitygate mcp
  realitygate doctor [dir]
      Check that the kit is wired correctly.

${c.bold("Options")}
  -h, --help       Show this help
  -v, --version    Show version
`;

// Flags that take a value as the next argument; every other flag is boolean
// unless written as --flag=value (e.g. --md=report.md).
const VALUE_FLAGS = new Set(["config", "gate", "min-score", "base", "srs", "compare", "test-cmd", "install", "start", "ready", "probe", "timeout"]);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") flags.help = true;
    else if (a === "-v" || a === "--version") flags.version = true;
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (eq !== -1) flags[key] = a.slice(eq + 1);
      else if (VALUE_FLAGS.has(key) && argv[i + 1] !== undefined) flags[key] = argv[++i];
      else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function statusLine(r) {
  const tag = r.status === "PASS" ? c.green("PASS") : r.status === "WARN" ? c.yellow("WARN") : c.red("FAIL");
  return `  ${tag}  ${r.name.padEnd(34)} ${c.dim(r.detail)}`;
}

function runOverrides(flags) {
  const str = (k) => (typeof flags[k] === "string" ? flags[k] : undefined);
  for (const k of ["test-cmd", "install", "start", "ready", "probe", "timeout"]) {
    if (flags[k] === true) throw new ConfigError(`--${k} needs a value`);
  }
  let timeout;
  if (flags.timeout !== undefined) {
    timeout = Number(flags.timeout);
    if (!Number.isFinite(timeout) || timeout <= 0) throw new ConfigError("--timeout needs a positive number of seconds");
  }
  if (str("ready") !== undefined) {
    try {
      new RegExp(str("ready"));
    } catch (e) {
      throw new ConfigError(`--ready is not a valid regular expression: ${e.message}`);
    }
  }
  return { test: str("test-cmd"), install: str("install"), start: str("start"), ready: str("ready"), probe: str("probe"), timeout };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;

  if (flags.version) {
    out(JSON.parse(readFileSync(join(KIT_ROOT, "package.json"), "utf8")).version);
    return 0;
  }
  if (!command || flags.help) {
    out(HELP);
    return command || flags.help ? 0 : 1;
  }

  switch (command) {
    case "audit": {
      const dir = resolve(rest[0] ?? ".");
      const configPath = typeof flags.config === "string" ? flags.config : undefined;
      const result = runAudit(dir, { configPath });
      if (flags.compare === true) throw new ConfigError("--compare needs a git ref, e.g. --compare origin/main");
      if (typeof flags.compare === "string") result.delta = auditDelta(auditAtRef(dir, flags.compare, { configPath }), result, flags.compare);
      result.checks = await executedChecks(dir, { configPath, exec: Boolean(flags.exec), run: runOverrides(flags) });
      if (typeof flags["pr-comment"] === "string") writeFileSync(resolve(flags["pr-comment"]), prCommentMarkdown(result));
      if (flags.json) out(JSON.stringify(result, null, 2));
      else printAudit(result, { limit: flags.all ? Infinity : 20 });
      if (flags.md) {
        const file = typeof flags.md === "string" ? flags.md : "REALITY-AUDIT.md";
        writeFileSync(resolve(file), auditMarkdown(result));
        if (!flags.json) out(c.dim(`Full report written to ${file}`));
      }
      if (flags["min-score"] !== undefined) {
        const min = Number(flags["min-score"]);
        if (!Number.isFinite(min)) throw new ConfigError("--min-score needs a number");
        if (result.score < min) {
          err(c.red(`Reality Score ${result.score} is below the required ${min}.`));
          return 1;
        }
      }
      if (flags.exec && result.checks.some((ch) => ch.status === "FAIL")) {
        err(c.red("At least one executed check failed (see \"Executed\" above)."));
        return 1;
      }
      return 0;
    }
    case "boot": {
      const dir = resolve(rest[0] ?? ".");
      const config = loadConfig(dir, typeof flags.config === "string" ? flags.config : undefined);
      for (const [k, v] of Object.entries(runOverrides(flags))) if (v !== undefined && k !== "test") config.run[k] = v;
      if (!flags.json) out(c.bold("realitygate boot — clean install, documented env vars only"));
      const r = await runBoot(dir, config.run);
      if (flags.json) out(JSON.stringify(r, null, 2));
      else bootLine(r).forEach((l) => out(l));
      if (r.status === "NOT RUN") throw new ConfigError(r.detail);
      return r.status === "PASS" ? 0 : 1;
    }
    case "check": {
      const dir = resolve(rest[0] ?? ".");
      const base = typeof flags.changed === "string" ? flags.changed : typeof flags.base === "string" ? flags.base : "HEAD";
      const onlyFiles = flags.changed ? changedFiles(dir, base) : undefined;
      const deleted = flags.changed ? deletedFiles(dir, base) : undefined;
      const result = runCheck(dir, { configPath: typeof flags.config === "string" ? flags.config : undefined, onlyFiles, deleted });
      if (onlyFiles) result.base = base;
      if (flags.json) out(JSON.stringify(result, null, 2));
      else printCheck(result);
      return result.ok ? 0 : 1;
    }
    case "selftest": {
      if (flags.gate === true) throw new ConfigError('--gate needs a command, e.g. --gate "bash scripts/verify.sh"');
      const result = runSelftest(resolve(rest[0] ?? "."), {
        configPath: typeof flags.config === "string" ? flags.config : undefined,
        gate: typeof flags.gate === "string" ? flags.gate : undefined,
      });
      out(c.bold("realitygate selftest — can every gate fail?"));
      result.results.forEach((r) => out(statusLine(r)));
      out(result.ok ? c.green("selftest: every gate proved it can fail") : c.red("selftest: at least one gate cannot fail — it is broken, not passing"));
      return result.ok ? 0 : 1;
    }
    case "init": {
      if (flags.srs === true) throw new ConfigError("--srs needs a file path, e.g. --srs ./SRS.pdf");
      const results = runInit(resolve(rest[0] ?? "."), { force: Boolean(flags.force), srs: typeof flags.srs === "string" ? flags.srs : undefined });
      results.forEach((r) => out(`  ${r.action.padEnd(18)} ${r.file}`));
      out();
      out(flags.srs
        ? "Next: add any research or notes to docs/input/, then follow START-HERE.md (Phase 0)."
        : "Next: put your SRS in docs/input/ (or fill in docs/IDEA.md if you have none), then follow START-HERE.md.");
      return 0;
    }
    case "hooks": {
      if (rest[0] !== "install") {
        err("Usage: realitygate hooks install [dir] [--git]");
        return 1;
      }
      if (flags.git) {
        const path = installGitHook(resolve(rest[1] ?? "."));
        out(`Installed git pre-commit gate: ${path}`);
        out(c.dim("Every commit, by any agent or human, now runs `realitygate check`."));
        return 0;
      }
      const result = installHooks(resolve(rest[1] ?? "."));
      out(`Installed ${result.scripts.length} guard scripts into .claude/hooks/`);
      out(result.added.length ? `Registered in ${result.settingsPath}: ${result.added.join(", ")}` : "Hooks were already registered; nothing to add.");
      out(c.dim("Restart Claude Code (or open /hooks) so the new hooks load."));
      return 0;
    }
    case "proof": {
      const dir = resolve(rest[0] ?? ".");
      const result = runProof(dir);
      if (flags.json) out(JSON.stringify(result, null, 2));
      else {
        out(c.bold(`realitygate proof — ${result.verified}/${result.total} DONE tasks verified`));
        for (const t of result.tasks) {
          const missing = t.evidence.filter((e) => !e.ok).map((e) => e.label);
          out(`  ${t.verified ? c.green("✓") : c.red("✗")} ${t.id.padEnd(10)} ${t.verified ? c.dim("all evidence present") : c.dim(t.note || `missing: ${missing.join(", ")}`)}`);
        }
        out(c.dim(result.badge));
      }
      if (flags.md) {
        const file = typeof flags.md === "string" ? flags.md : join(dir, "PROOF.md");
        writeFileSync(resolve(file), proofMarkdown(result));
        if (!flags.json) out(c.dim(`Ledger written to ${file}`));
      }
      return flags.strict && result.verified < result.total ? 1 : 0;
    }
    case "review-pack": {
      if (!rest[0]) throw new ConfigError("usage: realitygate review-pack <task-spec.md> [--base <git-ref>]");
      const result = buildReviewPack(".", rest[0], { base: typeof flags.base === "string" ? flags.base : "HEAD" });
      out(`Review pack written to ${result.outPath} (${result.changedFiles} file(s), ${Math.round(result.bytes / 1024)} KB)`);
      out("Paste it into a reviewer from a different model family, then record the verdict under ## Review in the journal.");
      return 0;
    }
    case "agents": {
      if (rest[0] !== "install") {
        err("Usage: realitygate agents install [dir]");
        return 1;
      }
      const written = installAgents(resolve(rest[1] ?? "."));
      out(c.bold("RealityGate for every coding assistant"));
      written.forEach((w) => out(`  ${w.file.padEnd(46)} ${c.dim(w.for)}`));
      out();
      out("Next: add the pre-commit gate for every agent with `realitygate hooks install --git`.");
      return 0;
    }
    case "scan-skills": {
      const r = scanSkills(rest[0] ?? ".");
      if (flags.json) {
        out(JSON.stringify(r, null, 2));
      } else {
        out(c.bold(`realitygate scan-skills — ${r.root}`));
        out(c.dim(`scanned ${r.filesScanned} files · ${r.inventory.skills.length} skills · ${r.inventory.hooks.length} hooks · ${r.inventory.mcpServers.length} MCP servers`));
        if (r.ignored.length) {
          out(c.yellow("Excluded by the publisher (trust.ignore). Review these yourself:"));
          r.ignored.forEach((t) => out(`  ${t.glob} (${t.files} files): ${t.reason}`));
        }
        out(c.bold("What it would run"));
        r.inventory.hooks.forEach((h) => out(`  hook  ${h.event} [${h.matcher}] → ${h.command}`));
        r.inventory.mcpServers.forEach((m) => out(`  mcp   ${m.name} → ${m.target}`));
        r.inventory.installScripts.forEach((i) => out(`  install-script  ${i.hook}: ${i.cmd}`));
        if (r.inventory.spawnsProcesses.length) out(`  spawns processes: ${r.inventory.spawnsProcesses.join(", ")}`);
        if (!r.inventory.hooks.length && !r.inventory.mcpServers.length && !r.inventory.installScripts.length && !r.inventory.spawnsProcesses.length) out(c.dim("  nothing executable found"));
        if (r.inventory.images.length) out(c.dim(`  images (complete PNG/JPEG/GIF/WebP, not executable): ${r.inventory.images.join(", ")}`));
        for (const f of r.findings) {
          const tag = f.severity === "HIGH" ? c.red("HIGH  ") : c.yellow("MEDIUM");
          out(`  ${tag} ${f.file}:${f.line}  ${c.bold(f.id)} ${f.label}`);
          if (f.text) out(c.dim(`         ${f.text}`));
        }
        out();
        if (r.high) out(c.red(`${r.high} HIGH red flag(s). Do not install until a human has read every flagged line.`));
        else if (r.medium) out(c.yellow(`No HIGH red flags. ${r.medium} item(s) to review before installing.`));
        else out(c.green("No red flags found."));
        out(c.dim("A clean scan is not a guarantee: malicious instructions can be phrased in ways no pattern catches. Read the skills, check the publisher, prefer pinned versions."));
      }
      return r.high || (flags.strict && r.medium) ? 1 : 0;
    }
    case "mcp": {
      await serveStdio();
      return 0;
    }
    case "doctor": {
      const result = runDoctor(resolve(rest[0] ?? "."));
      out(c.bold("realitygate doctor"));
      result.results.forEach((r) => out(statusLine(r)));
      return result.ok ? 0 : 1;
    }
    default:
      err(`Unknown command: ${command}`);
      out(HELP);
      return 1;
  }
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof ConfigError || ["NOTHING_TO_AUDIT", "NO_STATE", "BAD_INPUT"].includes(e?.code)) {
    err(c.red(`realitygate: ${e.message}`));
    process.exitCode = 2;
  } else {
    throw e;
  }
}
