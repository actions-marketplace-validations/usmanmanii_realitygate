import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Proof Ledger: for every task marked DONE in .agent/STATE.json, checks that its
 * journal carries the evidence the Build OS requires — failing tests first, a
 * green gate, an APPROVED independent review, a real execution, and a commit
 * that exists in git. Headings are matched loosely (journals are written by
 * agents and humans); contents are matched strictly (a plan is not output).
 */
const BLOCK = /```[^\n]*\n[\s\S]*?\S[\s\S]*?```/;
const FAILURE_OUTPUT =
  /```[^\n]*\n[\s\S]*?(?:✖|✗|\bFAIL(?:ED)?\b|\bfailing\b|\d+ fail(?:ed|ing)?\b|\bAssertionError\b|\bexpected\b[\s\S]*?\bgot\b)[\s\S]*?```|\b\d+ failed\b|✖/i;
const GATE_OUTPUT = /EXIT=0|all gates green|gate green|reality-check: clean|✅|\b\d+\/\d+\b/i;
const RUN_OUTPUT = /EXIT=0|\b\d+\/\d+\b|HTTP\/\d|→\s*\d{3}\b|\bcurl\b|\bstatus \d{3}\b/i;

export const EVIDENCE = [
  {
    id: "tests",
    label: "Tests failed first",
    heading: /tests?\b.*\bfirst|written first|failing tests?/i,
    ok: (s) => FAILURE_OUTPUT.test(s.body),
  },
  {
    id: "gate",
    label: "Gate green",
    heading: /\bgate\b|\bverify\b|\bevidence\b|\boutcome\b/i,
    ok: (s) => BLOCK.test(s.body) || GATE_OUTPUT.test(s.heading + s.body),
  },
  {
    id: "review",
    label: "Review APPROVED",
    heading: /\breview\b|\bverdict\b|\bverifier\b/i,
    last: true,
    ok: (s) => /\bAPPROVED\b/.test(s.heading + s.body) && !/\bREJECTED\b/.test(s.heading),
  },
  {
    id: "proof",
    label: "Ran for real",
    heading: /\bproof\b|\bproven\b|\bexecution\b|\bevidence\b|\boutcome\b|\bsmoke\b/i,
    ok: (s) => BLOCK.test(s.body) || RUN_OUTPUT.test(s.heading + s.body),
  },
  { id: "commit", label: "Commit exists", heading: /\bcommit\b/i, commit: true },
];

export function runProof(rootArg) {
  const root = resolve(rootArg);
  const statePath = join(root, ".agent", "STATE.json");
  if (!existsSync(statePath)) {
    const e = new Error("no .agent/STATE.json — the Proof Ledger reads tasks from the Build OS state file");
    e.code = "NO_STATE";
    throw e;
  }
  let state;
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch (err) {
    const e = new Error(`.agent/STATE.json is not valid JSON: ${err.message}`);
    e.code = "NO_STATE";
    throw e;
  }

  const journalDir = join(root, ".agent", "journal");
  const journals = existsSync(journalDir) ? new Set(readdirSync(journalDir)) : new Set();
  const done = Object.entries(state.tasks ?? {})
    .filter(([, status]) => String(status).toUpperCase() === "DONE")
    .map(([id]) => id)
    .sort();

  const tasks = done.map((id) => {
    const file = `${id}.md`;
    if (!journals.has(file)) {
      return { id, verified: false, evidence: EVIDENCE.map((e) => ({ id: e.id, label: e.label, ok: false })), note: "no journal entry" };
    }
    const text = readFileSync(join(journalDir, file), "utf8").replace(/\r\n/g, "\n");
    const evidence = EVIDENCE.map((e) => ({ id: e.id, label: e.label, ok: hasEvidence(root, id, text, e) }));
    return { id, verified: evidence.every((e) => e.ok), evidence, note: "" };
  });

  const verified = tasks.filter((t) => t.verified).length;
  return { project: state.project ?? null, total: tasks.length, verified, tasks, badge: proofBadge(verified, tasks.length) };
}

/** Every section whose heading text matches `re`: { heading, body } up to the next same-or-higher heading. */
export function sections(text, re) {
  const out = [];
  const headings = [...text.matchAll(/^(#{2,4})\s+(.*)$/gm)];
  headings.forEach((h, i) => {
    if (!re.test(h[2])) return;
    const level = h[1].length;
    const start = h.index + h[0].length;
    const next = headings.slice(i + 1).find((n) => n[1].length <= level);
    out.push({ heading: h[2], body: text.slice(start, next ? next.index : text.length) });
  });
  return out;
}

function hasEvidence(root, taskId, text, e) {
  if (e.commit) {
    const shas = sections(text, e.heading).flatMap((s) => s.body.match(/\b[0-9a-f]{7,40}\b/g) ?? []);
    return shas.some((sha) => commitExists(root, sha)) || commitMentions(root, taskId);
  }
  const found = sections(text, e.heading);
  if (found.length === 0) return false;
  return e.last ? e.ok(found[found.length - 1]) : found.some(e.ok);
}

function commitExists(root, sha) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Conventional commits reference their task: "feat(ledger): … [T-004]". */
function commitMentions(root, taskId) {
  try {
    const out = execFileSync("git", ["log", "-F", `--grep=[${taskId}]`, "--format=%h", "-n", "1"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() !== "";
  } catch {
    return false;
  }
}

export function proofBadge(verified, total) {
  const color = total === 0 ? "lightgrey" : verified === total ? "brightgreen" : verified / total >= 0.8 ? "yellow" : "red";
  return `![Tasks verified](https://img.shields.io/badge/tasks%20verified-${verified}%2F${total}-${color})`;
}

export function proofMarkdown(r) {
  const mark = (ok) => (ok ? "✅" : "❌");
  const lines = [
    "# PROOF — how every task was verified",
    "",
    r.badge,
    "",
    `**${r.verified} of ${r.total} DONE tasks carry full evidence.** Generated by \`realitygate proof\` from \`.agent/STATE.json\` and \`.agent/journal/\`.`,
    "",
    `| Task | ${EVIDENCE.map((e) => e.label).join(" | ")} | Verified |`,
    `|---|${EVIDENCE.map(() => "---").join("|")}|---|`,
  ];
  for (const t of r.tasks) {
    lines.push(`| ${t.id}${t.note ? ` (${t.note})` : ""} | ${t.evidence.map((e) => mark(e.ok)).join(" | ")} | ${mark(t.verified)} |`);
  }
  lines.push("");
  lines.push("Evidence rules: a *Tests first* section with pasted failing output; a *Gate* / *Evidence* section with gate");
  lines.push("output; the last *Review* / *Verifier* section APPROVED; a *Proof* / *Evidence* section with real execution");
  lines.push("output; and a commit that exists — named in a *Commit* section, or referencing `[T-XXX]` in its message.");
  lines.push("");
  return lines.join("\n");
}
