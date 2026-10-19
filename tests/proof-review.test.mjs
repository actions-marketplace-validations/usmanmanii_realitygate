import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { runProof, sections } from "../src/proof.mjs";
import { buildReviewPack } from "../src/review-pack.mjs";
import { cli, hasGit, makeProject } from "./helpers.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));
const project = (files, opts) => {
  const p = makeProject(files, opts);
  cleanups.push(p.cleanup);
  return p.dir;
};
const git = (dir, ...args) =>
  execFileSync("git", ["-c", "user.email=t@t.t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).trim();

const journal = (sha, { review = "VERDICT: [APPROVED]" } = {}) => `# T-001 — thing

## Plan
do it

## Tests first (failing output)
\`\`\`
✖ invite rejects non-owner (expected 403, got 404)
\`\`\`

## Gate (green output)
\`\`\`
✅ all gates green
\`\`\`

## Review
${review}

## Proof
\`\`\`
$ curl -X POST /api/invites → 201
\`\`\`

## Commit
${sha}
`;

describe("proof ledger", { skip: !hasGit() && "git not installed" }, () => {
  test("verifies a DONE task with full evidence and a real commit; flags the rest", () => {
    const dir = project({ "a.txt": "x" }, { git: true });
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "init");
    const sha = git(dir, "rev-parse", "--short", "HEAD");
    const files = {
      ".agent/STATE.json": JSON.stringify({ project: "p", tasks: { "T-001": "DONE", "T-002": "DONE", "T-003": "DONE", "T-004": "TODO" } }),
      ".agent/journal/T-001.md": journal(sha),
      ".agent/journal/T-002.md": journal(sha, { review: "VERDICT: [REJECTED]" }),
      ".agent/journal/T-004.md": journal(sha),
    };
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    const r = runProof(dir);
    assert.equal(r.total, 3, "only DONE tasks count");
    assert.equal(r.verified, 1);
    const byId = Object.fromEntries(r.tasks.map((t) => [t.id, t]));
    assert.equal(byId["T-001"].verified, true);
    assert.equal(byId["T-002"].evidence.find((e) => e.id === "review").ok, false);
    assert.equal(byId["T-003"].note, "no journal entry");
    assert.match(r.badge, /tasks%20verified-1%2F3-red/);

    const res = cli(["proof", dir, "--md", "--strict"]);
    assert.equal(res.code, 1, "--strict fails when any DONE task lacks evidence");
    assert.ok(existsSync(join(dir, "PROOF.md")));
    assert.match(readFileSync(join(dir, "PROOF.md"), "utf8"), /1 of 3 DONE tasks/);
  });

  test("a commit sha that does not exist is not evidence", () => {
    const dir = project({ ".agent/STATE.json": { tasks: { "T-001": "DONE" } }, ".agent/journal/T-001.md": journal("deadbeef1234") }, { git: true });
    assert.equal(runProof(dir).tasks[0].evidence.find((e) => e.id === "commit").ok, false);
  });

  test("an empty code block is not evidence", () => {
    const text = journal("abc1234").replace("✅ all gates green", "");
    const dir = project({ ".agent/STATE.json": { tasks: { "T-001": "DONE" } }, ".agent/journal/T-001.md": text }, { git: true });
    assert.equal(runProof(dir).tasks[0].evidence.find((e) => e.id === "gate").ok, false);
  });

  test("no STATE.json is a clear error (exit 2)", () => {
    assert.equal(cli(["proof", project({})]).code, 2);
  });

  test("sections() stops at the next heading of the same level", () => {
    assert.equal(sections("## A\none\n### sub\ntwo\n## B\nthree", /^A$/)[0].body.trim(), "one\n### sub\ntwo");
  });

  test("real-world journal formats: verifier rounds, Evidence lines, [T-XXX] commit messages", () => {
    const dir = project({ "a.txt": "x" }, { git: true });
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "feat(x): thing [T-009]");
    const text = [
      "# T-009",
      "## Tests (written first, must fail before implementation)",
      "```",
      "✖ rejects reused token (expected 410, got 200)",
      "```",
      "## Verifier round 1 → REJECTED; fixes applied",
      "## Verifier round 2 → APPROVED (gate re-run green by verifier)",
      "## Evidence: vitest 28/28 · verify.sh EXIT=0",
      "",
    ].join("\n");
    mkdirSync(join(dir, ".agent", "journal"), { recursive: true });
    writeFileSync(join(dir, ".agent", "STATE.json"), JSON.stringify({ tasks: { "T-009": "DONE" } }));
    writeFileSync(join(dir, ".agent", "journal", "T-009.md"), text);
    const t = runProof(dir).tasks[0];
    assert.equal(t.verified, true, JSON.stringify(t.evidence));
  });

  test("a later REJECTED round overrides an earlier APPROVED one", () => {
    const text = "## Verifier round 1 → APPROVED\n## Verifier round 2 → REJECTED (2 MAJOR)\n";
    const dir = project({ ".agent/STATE.json": { tasks: { "T-1": "DONE" } }, ".agent/journal/T-1.md": text }, { git: true });
    assert.equal(runProof(dir).tasks[0].evidence.find((e) => e.id === "review").ok, false);
  });
});

describe("review pack", { skip: !hasGit() && "git not installed" }, () => {
  test("bundles instructions, spec, diff and new files — never .env", () => {
    const dir = project({ "src/a.ts": "export const a = 1;\n", "specs/T-001.md": "# T-001\n## Acceptance criteria\n1. a is 2\n" }, { git: true });
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "init");
    writeFileSync(join(dir, "src/a.ts"), "export const a = 2;\n");
    writeFileSync(join(dir, "src/b.ts"), "export const b = 3;\n");
    writeFileSync(join(dir, ".env"), "SECRET=never-in-pack\n");

    const r = buildReviewPack(dir, "specs/T-001.md");
    const text = readFileSync(r.outPath, "utf8");
    assert.match(text, /VERDICT: \[APPROVED\] or \[REJECTED\]/);
    assert.match(text, /a is 2/);
    assert.match(text, /-export const a = 1;/);
    assert.match(text, /\+export const a = 2;/);
    assert.match(text, /src\/b\.ts \(new, untracked\)/);
    assert.ok(!text.includes("never-in-pack"));
    assert.equal(r.outPath, join(dir, ".agent", "review", "T-001.md"));
  });

  test("nothing changed is an error", () => {
    const dir = project({ "src/a.ts": "x\n", "specs/T.md": "# T\n" }, { git: true });
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "init");
    assert.throws(() => buildReviewPack(dir, "specs/T.md"), /nothing to review/);
  });

  test("missing spec is an error", () => {
    assert.throws(() => buildReviewPack(project({}, { git: true }), "nope.md"), /not found/);
  });
});

describe("plugin packaging", () => {
  const KIT = join(import.meta.dirname, "..");
  const json = (rel) => JSON.parse(readFileSync(join(KIT, rel), "utf8"));

  test("plugin.json and marketplace.json agree on the name and version", () => {
    const plugin = json(".claude-plugin/plugin.json");
    const market = json(".claude-plugin/marketplace.json");
    const pkg = json("package.json");
    assert.equal(plugin.name, "realitygate");
    assert.equal(market.plugins[0].name, plugin.name);
    assert.equal(market.plugins[0].source, "./");
    assert.equal(plugin.version, pkg.version);
    assert.equal(market.owner.name, "Muhammad Usman");
  });

  test("every skill has name + description frontmatter and references the CLI that exists", () => {
    for (const skill of ["audit", "fix", "gate", "build", "review", "scan"]) {
      const text = readFileSync(join(KIT, "skills", skill, "SKILL.md"), "utf8");
      const fm = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n/g, "\n"))?.[1] ?? "";
      assert.match(fm, new RegExp(`^name: ${skill}$`, "m"), skill);
      assert.match(fm, /^description: .{80,}/m, `${skill} description is specific enough to trigger`);
      assert.match(text, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/realitygate\.mjs/);
    }
    assert.ok(existsSync(join(KIT, "bin", "realitygate.mjs")));
  });

  test("hooks.json references scripts that exist, in exec form", () => {
    const hooks = json("hooks/hooks.json").hooks.PreToolUse.flatMap((g) => g.hooks);
    for (const h of hooks) {
      assert.equal(h.command, "node");
      const script = h.args[0].replace("${CLAUDE_PLUGIN_ROOT}/", "");
      assert.ok(existsSync(join(KIT, script)), script);
    }
  });
});
