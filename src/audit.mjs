import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { loadConfig } from "./config.mjs";
import { documentedEnv, extractEnvReads, isProvided } from "./env.mjs";
import { SOURCE_EXT, TS_EXT, isSecretEnvFile, isTestFile, listFiles, parseJsonc, readJson, readText } from "./files.mjs";
import { exclusions, justifiedLines, scanFiles, scanManifests, scanTestFiles, selectSecretScanExtras, selectSources } from "./scan.mjs";
import { hasAssertion } from "./testquality.mjs";

/**
 * Category weights sum to 100. Each finding deducts points from its category,
 * capped at the category weight, so one noisy category cannot hide the rest.
 */
export const CATEGORIES = [
  { id: "fake", name: "Fake code", weight: 20 },
  { id: "hallucination", name: "Hallucinated imports", weight: 15 },
  { id: "security", name: "Security", weight: 25 },
  { id: "errors", name: "Error handling", weight: 10 },
  { id: "types", name: "Type safety", weight: 10 },
  { id: "tests", name: "Tests", weight: 15 },
  { id: "hygiene", name: "Hygiene", weight: 5 },
];

const RULE_COST = {
  "R-001": ["fake", 2],
  "R-002": ["fake", 4],
  "R-003": ["fake", 2],
  "R-004": ["fake", 3],
  "R-005": ["fake", 3],
  "R-010": ["fake", 0.5],
  "R-014": ["hallucination", 5],
  "R-011": ["security", 10],
  "R-012": ["security", 10],
  "R-015": ["security", 3],
  "R-013": ["errors", 2],
  "R-006": ["types", 1],
  "R-007": ["types", 0.5],
  "R-008": ["types", 0.5],
  "R-009": ["hygiene", 0.25],
  "R-016": ["hygiene", 2],
  "R-017": ["hygiene", 1],
  "R-018": ["fake", 0.5],
  "R-019": ["tests", 3],
  "R-020": ["tests", 1],
  "R-021": ["hallucination", 5],
  "R-022": ["fake", 4],
};
const CUSTOM_COST = ["security", 3];

const NEGATIVE_AUTHZ = /\b40[13]\b|forbidden|unauthori[sz]ed|not authori[sz]ed|access denied|permission denied|cannot (?:read|access|see|view|modify|edit|delete|update)|another user|other user|different user|\buser ?b\b|row[- ]level security|\bRLS\b/i;
const ROUTE_HINT = /(?:^|\/)app\/(?:.*\/)?route\.[cm]?[jt]s$|(?:^|\/)pages\/api\/|(?:^|\/)(?:routes|controllers|api|handlers)\//;
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "poetry.lock", "uv.lock", "Pipfile.lock"];
const NPM_DEFAULT_TEST = /no test specified/;

export function runAudit(rootArg, { configPath } = {}) {
  const root = resolve(rootArg);
  const config = loadConfig(root, configPath);
  const allFiles = listFiles(root);
  const { files: sources } = selectSources(root, config, allFiles);
  if (sources.length === 0) {
    const e = new Error("no source files found to audit (looked for .js/.ts/.jsx/.tsx/.py/.go outside tests)");
    e.code = "NOTHING_TO_AUDIT";
    throw e;
  }

  const findings = scanFiles(root, sources, config, { allFiles });
  const extras = selectSecretScanExtras(config, allFiles).filter((f) => !sources.includes(f));
  findings.push(...scanFiles(root, extras, config, { allFiles, onlyRuleIds: new Set(["R-011", "R-012"]) }));
  const tests = scanTestFiles(root, config, allFiles);
  findings.push(...tests.findings);
  findings.push(...scanManifests(root, config, allFiles).findings);

  const signals = projectSignals(root, allFiles, sources);
  const deductions = Object.fromEntries(CATEGORIES.map((cat) => [cat.id, []]));

  for (const f of findings) {
    const [cat, cost] = f.custom ? CUSTOM_COST : RULE_COST[f.rule] ?? ["hygiene", 0.5];
    // R-021's "can't verify, no lockfile" warning is already charged as the NO-LOCKFILE project check.
    deductions[cat].push({ cost: f.rule === "R-021" && f.severity === "warn" ? 0 : cost, reason: `${f.rule} ${f.label}`, finding: f });
  }
  for (const s of signals.issues) deductions[s.category].push({ cost: s.cost, reason: s.reason, signal: s.id });

  const categories = CATEGORIES.map((cat) => {
    const lost = Math.min(cat.weight, deductions[cat.id].reduce((sum, d) => sum + d.cost, 0));
    return { ...cat, score: round1(cat.weight - lost), items: deductions[cat.id] };
  });
  const score = Math.round(categories.reduce((sum, cat) => sum + cat.score, 0));

  return {
    project: projectName(root),
    score,
    grade: grade(score),
    categories,
    findings,
    signals,
    stats: { sourceFiles: sources.length, testFiles: signals.testFiles, testFilesWithAssertions: signals.testFilesWithAssertions, filesListed: allFiles.length },
    excluded: exclusions(root, config, allFiles),
    justified: justifiedLines(root, [...sources, ...tests.files]),
    fixPlan: fixPlan(categories, findings, signals),
    badge: badge(score),
  };
}

function projectSignals(root, allFiles, sources) {
  const issues = [];
  const tests = allFiles.filter((f) => SOURCE_EXT.test(f) && isTestFile(f));
  const pkg = readJson(root, "package.json");

  const trackedEnv = allFiles.filter(isSecretEnvFile);
  for (const f of trackedEnv) {
    issues.push({ id: "ENV-COMMITTED", category: "security", cost: 10, reason: `secret env file is in the repo (not git-ignored): ${f}` });
  }

  const routes = sources.filter((f) => ROUTE_HINT.test(f));
  if (tests.length === 0) {
    issues.push({ id: "NO-TESTS", category: "tests", cost: 15, reason: "no test files at all" });
  } else {
    const ratio = tests.length / sources.length;
    if (ratio < 0.1) issues.push({ id: "LOW-TEST-RATIO", category: "tests", cost: 8, reason: `very few tests: ${tests.length} test files for ${sources.length} source files` });
    else if (ratio < 0.3) issues.push({ id: "LOW-TEST-RATIO", category: "tests", cost: 4, reason: `thin tests: ${tests.length} test files for ${sources.length} source files` });

    if (routes.length > 0) {
      const hasNegativeAuthz = tests.some((t) => NEGATIVE_AUTHZ.test(readText(root, t) ?? ""));
      if (!hasNegativeAuthz) {
        issues.push({ id: "NO-NEGATIVE-AUTHZ", category: "tests", cost: 5, reason: `${routes.length} route file(s) but no negative-authorization test (401/403, "other user cannot …")` });
      }
    }
  }
  if (pkg && (!pkg.scripts?.test || NPM_DEFAULT_TEST.test(pkg.scripts.test))) {
    issues.push({ id: "NO-TEST-SCRIPT", category: "tests", cost: 2, reason: "package.json has no real `test` script" });
  }

  const isTs = sources.some((f) => TS_EXT.test(f));
  if (isTs && existsSync(join(root, "tsconfig.json"))) {
    let tsconfig = null;
    try {
      tsconfig = parseJsonc(readText(root, "tsconfig.json") ?? "{}");
    } catch {
      tsconfig = null;
    }
    const strict = tsconfig?.compilerOptions?.strict;
    if (strict === false || (strict === undefined && !tsconfig?.extends)) {
      issues.push({ id: "TS-NOT-STRICT", category: "types", cost: 4, reason: "tsconfig.json does not enable `strict`" });
    }
  }

  const env = documentedEnv(root, allFiles);
  const undocumented = new Set();
  for (const f of sources) {
    if (env.forFile(f)) continue;
    for (const { name, text } of extractEnvReads(f, readText(root, f) ?? "")) if (!isProvided(name) && !/justified:/.test(text)) undocumented.add(name);
  }
  if (undocumented.size > 0) {
    const list = [...undocumented].sort();
    issues.push({ id: "ENV-NO-EXAMPLE", category: "hygiene", cost: 2, reason: `code reads ${list.length} env var(s) with no .env.example in its folder or above: ${list.slice(0, 5).join(", ")}${list.length > 5 ? ", …" : ""}` });
  }

  const hasCi = allFiles.some((f) => /^\.github\/workflows\/.+\.ya?ml$|^\.gitlab-ci\.yml$|^\.circleci\/config\.yml$|^azure-pipelines\.yml$|^bitbucket-pipelines\.yml$/.test(f));
  if (!hasCi) issues.push({ id: "NO-CI", category: "hygiene", cost: 2, reason: "no CI workflow found" });

  const hasDeps = pkg && Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0;
  if (hasDeps && !LOCKFILES.some((l) => allFiles.includes(l))) {
    issues.push({ id: "NO-LOCKFILE", category: "hygiene", cost: 1, reason: "dependencies declared but no lockfile committed" });
  }

  const testFilesWithAssertions = tests.filter((t) => hasAssertion(t, readText(root, t) ?? "")).length;
  return { issues, testFiles: tests.length, testFilesWithAssertions, routeFiles: routes.length };
}

function fixPlan(categories, findings, signals) {
  const plan = [];
  const byRule = groupBy(findings.filter((f) => f.severity === "error"), (f) => f.rule);
  const topFiles = (list) => [...new Set(list.map((f) => f.file))].slice(0, 5).join(", ");
  const has = (id) => signals.issues.some((s) => s.id === id);

  if (byRule["R-011"] || byRule["R-012"] || has("ENV-COMMITTED")) {
    plan.push("URGENT: rotate exposed credentials, move secrets to the host's env store, git-ignore `.env*`, and remove public-prefixed secret env vars.");
  }
  if (byRule["R-014"]) plan.push(`Resolve ${byRule["R-014"].length} undeclared import(s): add the real package or remove the invented one (${topFiles(byRule["R-014"])}).`);
  const fake = ["R-001", "R-002", "R-003", "R-004", "R-005", "R-022"].flatMap((r) => byRule[r] ?? []);
  if (fake.length) plan.push(`Replace ${fake.length} stub/placeholder/hardcoded-example occurrence(s) with real implementations (${topFiles(fake)}).`);
  if (byRule["R-015"]) plan.push(`Add schema validation (e.g. zod) to ${byRule["R-015"].length} route(s) that read input (${topFiles(byRule["R-015"])}).`);
  if (has("NO-NEGATIVE-AUTHZ")) plan.push("Write negative-authorization tests: user A must get 401/403 on user B's objects, for every route that touches data.");
  if (byRule["R-013"]) plan.push(`Stop swallowing errors in ${byRule["R-013"].length} place(s): log with context and surface a failure state (${topFiles(byRule["R-013"])}).`);
  if (has("NO-TESTS") || has("LOW-TEST-RATIO")) plan.push("Add tests for the core user journey first (one integration test per acceptance criterion), then expand.");
  const types = ["R-006", "R-008"].flatMap((r) => byRule[r] ?? []);
  if (has("TS-NOT-STRICT")) plan.push("Enable `strict` in tsconfig.json and fix the resulting type errors.");
  if (types.length) plan.push(`Remove ${types.length} unjustified \`any\`/@ts-ignore (or add \`justified: <reason>\`).`);
  if (byRule["R-016"]) plan.push("Route cross-module data access through the owning module's service instead of its repo.");
  if (byRule["R-017"] || has("ENV-NO-EXAMPLE")) plan.push("Document every env var the code reads in `.env.example` (name and an example value), so a fresh install knows what to set.");
  if (has("NO-CI")) plan.push("Add a CI workflow that runs typecheck, tests and `npx realitygate check` on every push.");
  if (plan.length === 0) plan.push("No blocking issues found. Wire `realitygate check` and `realitygate selftest` into CI to keep it that way.");
  return plan;
}

export function grade(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function badge(score) {
  const color = { A: "brightgreen", B: "green", C: "yellow", D: "orange", F: "red" }[grade(score)];
  return `![Reality Score](https://img.shields.io/badge/Reality%20Score-${score}%2F100%20${grade(score)}-${color})`;
}

function projectName(root) {
  return readJson(root, "package.json")?.name ?? basename(root);
}

function groupBy(list, key) {
  const out = {};
  for (const item of list) (out[key(item)] ??= []).push(item);
  return out;
}

const round1 = (n) => Math.round(n * 10) / 10;
