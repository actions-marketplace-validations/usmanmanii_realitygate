import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { runAudit } from "../src/audit.mjs";
import { DEFAULT_CONFIG } from "../src/config.mjs";
import { extractEnvReads } from "../src/env.mjs";
import { listFiles } from "../src/files.mjs";
import { scanFiles, selectSources } from "../src/scan.mjs";
import { makeProject } from "./helpers.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));
const project = (files) => {
  const p = makeProject(files);
  cleanups.push(p.cleanup);
  return p.dir;
};

function scan(files) {
  const dir = project(files);
  const cfg = structuredClone(DEFAULT_CONFIG);
  const allFiles = listFiles(dir);
  const { files: sources } = selectSources(dir, cfg, allFiles);
  return scanFiles(dir, sources, cfg, { allFiles }).filter((f) => f.rule === "R-017");
}

const EXAMPLE = { ".env.example": "DATABASE_URL=postgres://localhost/app\n# SENTRY_DSN=\nexport API_BASE=http://localhost\n" };

describe("R-017 undocumented env vars", () => {
  test("flags a var the code reads that .env.example does not list", () => {
    const f = scan({ ...EXAMPLE, "src/pay.ts": "export const key = process.env.STRIPE_SECRET_KEY;\n" });
    assert.deepEqual(f.map((x) => [x.file, x.line]), [["src/pay.ts", 1]]);
    assert.match(f[0].text, /STRIPE_SECRET_KEY is not listed in \.env\.example/);
  });

  test("covers bracket access, import.meta.env, destructuring, Python and Go", () => {
    const f = scan({
      ...EXAMPLE,
      "src/a.ts": 'export const a = process.env["REDIS_URL"];\nexport const b = import.meta.env.VITE_MAP_KEY;\nconst { SMTP_HOST, DATABASE_URL } = process.env;\nexport { SMTP_HOST, DATABASE_URL };\n',
      "app/main.py": 'import os\nA = os.environ["OPENAI_KEY"]\nB = os.getenv("QUEUE_URL")\nC = os.environ.get("BUCKET")\n',
    });
    assert.deepEqual(f.map((x) => x.text.split(" ")[0]).sort(), ["BUCKET", "OPENAI_KEY", "QUEUE_URL", "REDIS_URL", "SMTP_HOST", "VITE_MAP_KEY"]);
  });

  test("reports each var once per file", () => {
    const f = scan({ ...EXAMPLE, "src/a.ts": "export const a = process.env.TOKEN;\nexport const b = process.env.TOKEN;\n" });
    assert.equal(f.length, 1);
  });

  test("documented, commented-out documented, platform-provided and builtin vars are not flagged", () => {
    const f = scan({
      ...EXAMPLE,
      "src/a.ts":
        "export const a = process.env.DATABASE_URL;\nexport const b = process.env.SENTRY_DSN;\nexport const c = process.env.API_BASE;\n" +
        "export const d = process.env.NODE_ENV;\nexport const e = process.env.PORT;\nexport const g = process.env.VERCEL_URL;\n" +
        "export const h = import.meta.env.MODE;\nexport const i = import.meta.env.DEV;\nexport const j = process.env.GITHUB_SHA;\n",
    });
    assert.deepEqual(f, []);
  });

  test("dynamic access, comments and justified lines are not flagged", () => {
    const f = scan({
      ...EXAMPLE,
      "src/a.ts": "export const get = (k: string) => process.env[k];\n// process.env.OLD_KEY\nexport const t = process.env.TRACE_ID; // justified: set by the load balancer\n",
    });
    assert.deepEqual(f, []);
  });

  test("the gate rule is silent when the project has no env example file", () => {
    assert.deepEqual(scan({ "src/a.ts": "export const k = process.env.STRIPE_SECRET_KEY;\n" }), []);
  });

  test("each file is checked against the example files in its folder and above, not a sibling app's", () => {
    const f = scan({
      "frontend/.env.example": "VITE_API_URL=http://localhost\n",
      "frontend/src/api.ts": "export const u = import.meta.env.VITE_API_URL;\nexport const k = import.meta.env.VITE_MAPS_KEY;\n",
      "backend/config.py": 'import os\nKEY = os.environ["OPENAI_API_KEY"]\n',
    });
    assert.deepEqual(f.map((x) => `${x.file}:${x.text}`), ["frontend/src/api.ts:VITE_MAPS_KEY is not listed in frontend/.env.example"]);
  });

  test("a root .env.example covers every folder", () => {
    const f = scan({ ".env.example": "OPENAI_API_KEY=\n", "backend/config.py": 'import os\nKEY = os.environ["OPENAI_API_KEY"]\nURL = os.getenv("QUEUE_URL")\n' });
    assert.deepEqual(f.map((x) => x.text), ["QUEUE_URL is not listed in .env.example"]);
  });

  test(".env.local is never read to decide what is documented", () => {
    const f = scan({ ...EXAMPLE, ".env.local": "STRIPE_SECRET_KEY=sk\n", "src/a.ts": "export const k = process.env.STRIPE_SECRET_KEY;\n" });
    assert.equal(f.length, 1);
  });

  test("extractEnvReads skips Vite builtins in destructuring", () => {
    assert.deepEqual(extractEnvReads("src/a.ts", "const { MODE, VITE_X } = import.meta.env;\n").map((r) => r.name), ["VITE_X"]);
  });
});

describe("audit env signal", () => {
  const base = { "package.json": { name: "x", scripts: { test: "node --test" } } };
  test("reads env vars with no .env.example: one project signal listing them", () => {
    const r = runAudit(project({ ...base, "src/a.ts": "export const k = process.env.STRIPE_SECRET_KEY;\nexport const n = process.env.NODE_ENV;\n" }));
    const s = r.signals.issues.find((i) => i.id === "ENV-NO-EXAMPLE");
    assert.ok(s);
    assert.match(s.reason, /1 env var\(s\).*STRIPE_SECRET_KEY/);
    assert.ok(r.fixPlan.some((p) => /\.env\.example/.test(p)));
  });
  test("no signal when the only reads are platform-provided", () => {
    const r = runAudit(project({ ...base, "src/a.ts": "export const n = process.env.NODE_ENV;\n" }));
    assert.ok(!r.signals.issues.some((i) => i.id === "ENV-NO-EXAMPLE"));
  });
  test("no signal when an example file exists (the R-017 rule takes over)", () => {
    const r = runAudit(project({ ...base, ...EXAMPLE, "src/a.ts": "export const k = process.env.STRIPE_SECRET_KEY;\n" }));
    assert.ok(!r.signals.issues.some((i) => i.id === "ENV-NO-EXAMPLE"));
    assert.ok(r.findings.some((f) => f.rule === "R-017"));
  });
});
