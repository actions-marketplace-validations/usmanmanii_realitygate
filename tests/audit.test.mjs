import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { badge, grade, runAudit } from "../src/audit.mjs";
import { cli, KIT, makeProject } from "./helpers.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));
const project = (files) => {
  const p = makeProject(files);
  cleanups.push(p.cleanup);
  return p.dir;
};

const HEALTHY = {
  "package.json": { name: "healthy", scripts: { test: "vitest run" }, dependencies: { zod: "3.23.8" }, devDependencies: { vitest: "2.1.0" } },
  "package-lock.json": "{}",
  "tsconfig.json": { compilerOptions: { strict: true } },
  ".github/workflows/ci.yml": "on: push\n",
  "app/api/orders/route.ts": 'import { z } from "zod";\nconst Body = z.object({ sku: z.string() });\nexport async function POST(req: Request): Promise<Response> {\n  return Response.json(Body.parse(await req.json()));\n}\n',
  "src/orders.ts": 'export function total(items: number[]): number {\n  return items.reduce((a, b) => a + b, 0);\n}\n',
  "tests/orders.test.ts": 'import { test } from "vitest";\ntest("user B cannot read user A order: 403", () => {});\n',
  "tests/route.test.ts": 'import { test } from "vitest";\ntest("rejects invalid body", () => {});\n',
};

describe("audit", () => {
  test("a healthy project scores an A", () => {
    const r = runAudit(project(HEALTHY));
    assert.equal(r.grade, "A", JSON.stringify(r.categories.map((c) => [c.id, c.score])));
    assert.equal(r.score, 100);
  });

  test("the deliberately broken example scores an F and finds every planted problem", () => {
    const r = runAudit(join(KIT, "examples", "vibe-coded-app"));
    assert.equal(r.grade, "F");
    const rules = new Set(r.findings.map((f) => f.rule));
    for (const id of ["R-001", "R-002", "R-003", "R-004", "R-005", "R-006", "R-008", "R-012", "R-013", "R-014", "R-015"]) {
      assert.ok(rules.has(id), `missing ${id}`);
    }
    const ids = r.signals.issues.map((s) => s.id);
    assert.ok(ids.includes("NO-TESTS"));
    assert.ok(ids.includes("NO-TEST-SCRIPT"));
    assert.match(r.fixPlan[0], /URGENT/);
  });

  test("category deductions are capped at the category weight", () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`src/f${i}.ts`, "export const a = 1; // TODO\n"]));
    const r = runAudit(project({ ...HEALTHY, ...many }));
    const fake = r.categories.find((c) => c.id === "fake");
    assert.equal(fake.score, 0);
    for (const cat of r.categories.filter((c) => !["fake", "tests"].includes(c.id))) {
      assert.equal(cat.score, cat.weight, `${cat.id} unaffected by fake-code findings`);
    }
  });

  test("a committed .env is flagged by name without reading it", () => {
    const r = runAudit(project({ ...HEALTHY, ".env": "SECRET=do-not-read\n" }));
    assert.ok(r.signals.issues.some((s) => s.id === "ENV-COMMITTED"));
    assert.ok(!JSON.stringify(r).includes("do-not-read"));
  });

  test("routes without a negative-authorization test are flagged", () => {
    const files = { ...HEALTHY, "tests/orders.test.ts": 'import { test } from "vitest";\ntest("creates order", () => {});\n' };
    const r = runAudit(project(files));
    assert.ok(r.signals.issues.some((s) => s.id === "NO-NEGATIVE-AUTHZ"));
  });

  test("non-strict tsconfig is flagged", () => {
    const r = runAudit(project({ ...HEALTHY, "tsconfig.json": { compilerOptions: { strict: false } } }));
    assert.ok(r.signals.issues.some((s) => s.id === "TS-NOT-STRICT"));
  });

  test("nothing to audit is an error, not a perfect score", () => {
    assert.throws(() => runAudit(project({ "README.md": "# hi\n" })), /no source files/);
    assert.equal(cli(["audit", project({ "README.md": "# hi\n" })]).code, 2);
  });

  test("grades and badge", () => {
    assert.deepEqual([95, 85, 75, 65, 10].map(grade), ["A", "B", "C", "D", "F"]);
    assert.match(badge(87), /Reality%20Score-87%2F100%20B-green/);
  });

  test("CLI: --json, --md and --min-score", () => {
    const dir = project({ ...HEALTHY, "src/x.ts": "export const x = 1; // FIXME\n" });
    const json = cli(["audit", dir, "--json"]);
    assert.equal(json.code, 0);
    const parsed = JSON.parse(json.stdout);
    assert.ok(parsed.score < 100);

    const mdPath = join(dir, "report.md");
    assert.equal(cli(["audit", dir, `--md=${mdPath}`]).code, 0);
    assert.ok(existsSync(mdPath));
    assert.match(readFileSync(mdPath, "utf8"), /# Reality Audit/);

    assert.equal(cli(["audit", dir, "--min-score", "100"]).code, 1);
    assert.equal(cli(["audit", dir, "--min-score", "50"]).code, 0);
  });
});
