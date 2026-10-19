import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { isSecretEnvFile } from "./files.mjs";

const MAX_UNTRACKED_BYTES = 200 * 1024;

export const REVIEWER_PROMPT = `You are an adversarial code auditor. You did not write this code. Assume it is wrong.
You are given ONE task spec and the diff that claims to implement it. Nothing else.

Audit in this order:
1. SCOPE: files changed outside the spec's allowlist; unrequested refactors or features.
2. REALITY: stubs, mocks or fixtures outside tests, hardcoded example content, TODO markers, invented package APIs.
3. CORRECTNESS: does every acceptance criterion have a test that really exercises it?
   A test that asserts nothing meaningful counts as missing.
4. SECURITY: authorization (including object-level), a negative-authorization test, input
   validation, secrets, injection, rate limits, idempotency on money.
5. FAILURE PATHS: swallowed errors, missing timeouts, partial writes without a transaction.
6. ARCHITECTURE and HARD CONSTRAINTS stated in the spec.

Output exactly:
VERDICT: [APPROVED] or [REJECTED]
FINDINGS:
- <BLOCKER|MAJOR|MINOR> <file:line> <what is wrong> → <the specific fix>

Any BLOCKER or MAJOR means REJECTED. Finding nothing is valid only if you read every changed line.`;

/**
 * Builds a self-contained review prompt (reviewer instructions + task spec + diff)
 * for a reviewer from a DIFFERENT model family than the author. Correlated errors
 * are the weak point of AI review; a second family fails differently.
 */
export function buildReviewPack(rootArg, specPath, { base = "HEAD" } = {}) {
  const root = resolve(rootArg);
  const specAbs = resolve(root, specPath);
  if (!existsSync(specAbs)) {
    const e = new Error(`task spec not found: ${specPath}`);
    e.code = "BAD_INPUT";
    throw e;
  }
  const spec = readFileSync(specAbs, "utf8");
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

  let diff;
  try {
    diff = git(["diff", base, "--", ".", ":(exclude,glob)**/.env*"]);
  } catch (err) {
    const e = new Error(`git diff against "${base}" failed: ${String(err.stderr ?? err.message).trim()}`);
    e.code = "BAD_INPUT";
    throw e;
  }

  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter((f) => f && !isSecretEnvFile(f) && !f.startsWith(".agent/review/"));
  const newFiles = [];
  for (const f of untracked) {
    const abs = join(root, f);
    const buf = readFileSync(abs);
    if (buf.length > MAX_UNTRACKED_BYTES || buf.includes(0)) {
      newFiles.push(`### ${f}\n(skipped: ${buf.includes(0) ? "binary" : "larger than 200 KB"})\n`);
    } else {
      newFiles.push(`### ${f} (new, untracked)\n\`\`\`\n${buf.toString("utf8")}\n\`\`\`\n`);
    }
  }

  if (!diff.trim() && newFiles.length === 0) {
    const e = new Error(`nothing to review: no changes against "${base}" and no new files`);
    e.code = "BAD_INPUT";
    throw e;
  }

  const name = basename(specAbs).replace(/\.md$/i, "");
  const content = [
    `# Review pack — ${name}`,
    "",
    "Paste this whole file into a reviewer from a different model family than the one that wrote the code,",
    "then record the verdict in the task's journal under `## Review`.",
    "",
    "## Reviewer instructions",
    "",
    REVIEWER_PROMPT,
    "",
    "## Task spec",
    "",
    spec.trim(),
    "",
    `## Diff (against ${base})`,
    "",
    "```diff",
    diff.trimEnd(),
    "```",
    "",
    ...(newFiles.length ? ["## New files", "", ...newFiles] : []),
  ].join("\n");

  const outDir = join(root, ".agent", "review");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${name}.md`);
  writeFileSync(outPath, content);
  return { outPath, bytes: Buffer.byteLength(content), changedFiles: (diff.match(/^diff --git /gm) ?? []).length + untracked.length };
}
