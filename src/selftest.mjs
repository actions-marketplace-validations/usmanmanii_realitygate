// Gate self-test: proves every check can actually FAIL. A rule that stays
// silent on its own canary, or an include target that matches nothing, is a
// broken gate. This file contains canary strings on purpose and is excluded
// from the kit's own scan (realitygate.config.json).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_CONFIG, loadConfig } from "./config.mjs";
import { listFiles } from "./files.mjs";
import { compileGlobs, staticPrefix } from "./glob.mjs";
import { scanFiles, scanManifests, scanTestFiles, selectSources } from "./scan.mjs";

const CANARIES = {
  "R-001": { content: "export const a = 1; // TODO wire up\n" },
  "R-002": { content: 'export function pay(): never {\n  throw new Error("not implemented");\n}\n' },
  "R-003": { content: 'export const copy = "Lorem ipsum dolor sit amet";\n' },
  "R-004": { content: "export const rate = 0.1; // hardcoded for now\n" },
  "R-005": { content: 'export const users = [{ name: "John Doe" }];\n' },
  "R-006": { content: '// @ts-ignore\nexport const x: number = "a" as unknown as number;\n' },
  "R-007": { content: "/* eslint-disable */\nexport const y = 1;\n" },
  "R-008": { content: "export function f(v: any): number {\n  return v;\n}\n" },
  "R-009": { content: 'export function g(): void {\n  console.log("hi");\n}\n' },
  "R-010": { content: "// const old = compute();\nexport const z = 1;\n" },
  "R-011": { content: `export const key = "${"AKIA" + "ABCDEFGHIJKLMNOP"}";\n` },
  "R-012": { content: `export const k = process.env.${"NEXT_PUBLIC_" + "SERVICE_ROLE_KEY"};\n` },
  "R-013": { content: 'export async function h(): Promise<void> {\n  try {\n    await fetch("/x");\n  } catch (e) {}\n}\n' },
  "R-014": { content: 'import pad from "left-pad-imaginary-pkg";\nexport const p = pad;\n' },
  "R-015": {
    path: "app/api/items/route.ts",
    // JSON.parse decodes; it must not count as validation (FAILURES F-019).
    content: "export async function POST(request: Request): Promise<Response> {\n  const body = JSON.parse(await request.text());\n  return Response.json(body);\n}\n",
  },
  "R-016": {
    path: "src/modules/billing/service.ts",
    content: 'import { findUser } from "../../modules/users/repo";\nexport const u = findUser;\n',
  },
  "R-017": { content: "export const hook = process.env.STRIPE_WEBHOOK_SECRET;\n" },
  "R-018": { content: "export function orphanCanary(): number {\n  return 1;\n}\n" },
  "R-019": { path: "src/canary-r019.test.ts", content: 'import { expect, test } from "vitest";\n\ntest("adds", () => {\n  expect(true).toBe(true);\n});\n' },
  "R-020": { path: "src/canary-r020.test.ts", content: 'import { expect, test } from "vitest";\n\ntest.skip("adds", () => {\n  expect(1 + 1).toBe(2);\n});\n' },
  "R-019 (Python)": { rule: "R-019", path: "pysvc/test_canary_r019.py", content: "def test_order():\n    pass\n" },
  // One asserting test must not hide a sibling that asserts nothing.
  "R-019 (per test)": {
    rule: "R-019",
    path: "src/canary-r019-per-test.test.ts",
    content: 'import { expect, test } from "vitest";\nimport { total } from "./orders";\n\ntest("sums", () => {\n  expect(total([1, 2])).toBe(3);\n});\n\ntest("sums again", () => {\n  const sum = total([2, 2]);\n});\n',
  },
  // A decoder under another name is still not validation.
  "R-015 (alias)": {
    rule: "R-015",
    path: "app/api/aliased/route.ts",
    content: "const decode = JSON;\n\nexport async function POST(request: Request): Promise<Response> {\n  const body = decode.parse(await request.text());\n  return Response.json(body);\n}\n",
  },
  "R-021": {
    path: "lockcanary/package.json",
    content: JSON.stringify({ name: "lock-canary", dependencies: { ms: "2.1.3", "left-pad-imaginary-pkg": "1.0.0" } }),
    extra: { "lockcanary/package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "lock-canary" }, "node_modules/ms": { version: "2.1.3" } } }) },
  },
  "R-022": { path: "src/billing/service.ts", content: "export async function charge(): Promise<Receipt | null> {\n  return null;\n}\n" },
  "R-019 (Go)": { rule: "R-019", path: "gosvc/canary_r019_test.go", content: 'package gosvc\n\nimport "testing"\n\nfunc TestOrder(t *testing.T) {\n}\n' },
  "R-006 (Python)": { rule: "R-006", path: "pysvc/canary_r006.py", content: "TOTAL = 1  # type: ignore\n" },
  "R-013 (Go)": { rule: "R-013", path: "gosvc/canary_r013.go", content: 'package gosvc\n\nimport "os"\n\nfunc Load() {\n\t_, err := os.ReadFile("x")\n\tif err != nil {\n\t}\n}\n' },
  "R-014 (Python)": { rule: "R-014", path: "pysvc/canary_r014.py", content: "import fastjsonx_imaginary\n\nVALUE = fastjsonx_imaginary.loads\n" },
  "R-014 (Go)": { rule: "R-014", path: "gosvc/canary_r014.go", content: 'package gosvc\n\nimport "github.com/imaginary-org/notreal"\n\nvar V = notreal.X\n' },
  "R-015 (Python)": {
    rule: "R-015",
    path: "pysvc/canary_r015.py",
    content: 'import json\n\nfrom flask import Flask, request\n\napp = Flask(__name__)\n\n\n@app.post("/orders")\ndef create():\n    return json.load(request.files["order"])\n',
  },
};

// Real, clean code: must produce ZERO findings (false-positive canary).
const CLEAN = {
  "src/clean.ts":
    'import { z } from "zod";\nimport { readFileSync } from "node:fs";\n\nconst Input = z.object({ path: z.string() });\n\nexport function load(raw: unknown): string {\n  const { path } = Input.parse(raw);\n  return readFileSync(path, "utf8");\n}\n',
  "app/api/ok/route.ts":
    'import { z } from "zod";\n\nconst Body = z.object({ name: z.string() });\n\nexport async function POST(request: Request): Promise<Response> {\n  const body = Body.parse(await request.json());\n  return Response.json(body);\n}\n',
  "src/settings.ts": 'export const databaseUrl = process.env.DATABASE_URL ?? "";\nexport const mode = process.env.NODE_ENV;\n',
  ".env.example": "DATABASE_URL=postgres://localhost:5432/app\n",
  "requirements.txt": "flask==3.1.0\npydantic==2.10.0\n",
  "pysvc/clean.py":
    'import json\nfrom typing import Optional\n\nfrom flask import Flask, request\nfrom pydantic import BaseModel\n\nfrom pysvc import helpers\n\napp = Flask(__name__)\n\n\nclass Order(BaseModel):\n    sku: str\n\n\n@app.post("/orders")\ndef create() -> str:\n    order = Order.model_validate(request.json)\n    return json.dumps({"sku": order.sku, "n": helpers.count(Optional)})\n',
  "pysvc/helpers.py": "def count(value: object) -> int:\n    return 1 if value else 0\n",
  "go.mod": "module example.com/canary\n\ngo 1.22\n\nrequire github.com/google/uuid v1.6.0\n",
  "gosvc/clean.go":
    'package gosvc\n\nimport (\n\t"fmt"\n\t"net/http"\n\n\t"example.com/canary/internal/store"\n\t"github.com/google/uuid"\n)\n\nfunc Handle(w http.ResponseWriter, r *http.Request) error {\n\tid, err := store.Save(uuid.NewString())\n\tif err != nil {\n\t\treturn fmt.Errorf("save: %w", err)\n\t}\n\t_, err = fmt.Fprint(w, id)\n\treturn err\n}\n',
  "src/clean.test.ts":
    'import { describe, expect, it } from "vitest";\nimport { load } from "./clean";\n\ndescribe("load", () => {\n  it.skipIf(process.platform === "win32")("reads the file", () => {\n    expect(load({ path: "package.json" })).toContain("name");\n  });\n  it("rejects input without a path", () => {\n    expect(() => load({})).toThrow();\n  });\n});\n',
  "pysvc/test_clean.py": "import pytest\n\nfrom pysvc import helpers\n\n\n@pytest.mark.skipif(True, reason=\"needs a database\")\ndef test_count_db() -> None:\n    assert helpers.count(1) == 1\n\n\ndef test_count() -> None:\n    \"\"\"Truthy values count as one.\"\"\"\n    assert helpers.count(1) == 1\n",
  "gosvc/clean_test.go": 'package gosvc\n\nimport "testing"\n\nfunc TestHandle(t *testing.T) {\n\tif err := Handle(nil, nil); err == nil {\n\t\tt.Fatal("want an error")\n\t}\n}\n',
  "src/index.ts": 'import { load } from "./clean";\nimport { databaseUrl, mode } from "./settings";\n\nexport const app = { load, databaseUrl, mode };\n',
  "package.json": JSON.stringify({ name: "vibe-canary", dependencies: { zod: "3.23.8" } }, null, 2),
  // Every declared dependency is locked, so R-021 must stay silent here.
  "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "vibe-canary" }, "node_modules/zod": { version: "3.23.8" } } }),
  "uv.lock": 'version = 1\n\n[[package]]\nname = "flask"\nversion = "3.1.0"\n\n[[package]]\nname = "pydantic"\nversion = "2.10.0"\n',
  "go.sum": "github.com/google/uuid v1.6.0 h1:NIvaJDMOsjHA8n1jAhLSgzrAzy1Hgr+hNrb57e+94F0=\ngithub.com/google/uuid v1.6.0/go.mod h1:TIyPZe4MgqvfeYDBFedMoGGpEw/LqOeaOT+nhxU+yHo=\n",
};

export const GATE_CANARY_NAME = "__realitygate_canary__.ts";

export function runSelftest(rootArg, { configPath, gate } = {}) {
  const root = resolve(rootArg);
  const config = loadConfig(root, configPath);
  const results = [];

  results.push(...ruleCanaries(config));
  results.push(...scanIntegrity(root, config));
  if (gate) results.push(gateCanary(root, config, gate));

  return { ok: results.every((r) => r.status !== "FAIL"), results };
}

function ruleCanaries(projectConfig) {
  const results = [];
  const dir = mkdtempSync(join(tmpdir(), "vibe-selftest-"));
  try {
    const disabled = new Set(projectConfig.disable);
    const config = { ...structuredClone(DEFAULT_CONFIG), rules: projectConfig.rules, fileRules: projectConfig.fileRules, disable: projectConfig.disable };
    const expected = new Map();

    for (const [name, canary] of Object.entries(CANARIES)) {
      const id = canary.rule ?? name;
      if (disabled.has(id)) {
        results.push({ name: `${name} canary`, status: "WARN", detail: "rule disabled in config — not verified" });
        continue;
      }
      const path = canary.path ?? `src/canary-${id.toLowerCase()}.ts`;
      write(dir, path, canary.content);
      for (const [extraPath, content] of Object.entries(canary.extra ?? {})) write(dir, extraPath, content);
      expected.set(path, { name, id });
    }
    for (const rule of [...projectConfig.rules, ...projectConfig.fileRules]) {
      if (disabled.has(rule.id)) continue;
      if (!rule.canary) {
        results.push({ name: `${rule.id} canary`, status: "WARN", detail: "custom rule has no `canary` — add one so the gate can prove it fires" });
        continue;
      }
      const path = synthesizePath(rule.paths, rule.id);
      if (!path) {
        results.push({ name: `${rule.id} canary`, status: "WARN", detail: `could not build a file path matching ${rule.paths.join(", ")}` });
        continue;
      }
      write(dir, path, rule.canary);
      expected.set(path, { name: rule.id, id: rule.id });
    }
    for (const [path, content] of Object.entries(CLEAN)) write(dir, path, content);

    const allFiles = listFiles(dir);
    const { files } = selectSources(dir, config, allFiles);
    const findings = scanFiles(dir, files, config, { allFiles });
    findings.push(...scanTestFiles(dir, config, allFiles).findings);
    findings.push(...scanManifests(dir, config, allFiles).findings);

    for (const [path, { name, id }] of expected) {
      const fired = findings.some((f) => f.file === path && f.rule === id);
      results.push({
        name: `${name} canary`,
        status: fired ? "PASS" : "FAIL",
        detail: fired ? "fires on its planted violation" : `stayed silent on ${path} — this rule cannot fail`,
      });
    }
    const cleanHits = findings.filter((f) => f.file in CLEAN);
    results.push({
      name: "false-positive canary",
      status: cleanHits.length === 0 ? "PASS" : "FAIL",
      detail: cleanHits.length === 0 ? "clean code produces zero findings" : cleanHits.map((f) => `${f.rule} at ${f.file}:${f.line}`).join("; "),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return results;
}

function scanIntegrity(root, config) {
  const { targets, files } = selectSources(root, config);
  const emptyAllowed = compileGlobs(Object.keys(config.mayBeEmpty));
  const results = targets.map((t) => {
    if (t.count > 0) return { name: `scan target ${t.glob}`, status: "PASS", detail: `${t.count} files` };
    if (config.mayBeEmpty[t.glob] || emptyAllowed(t.glob)) {
      return { name: `scan target ${t.glob}`, status: "WARN", detail: `empty, allowed: ${config.mayBeEmpty[t.glob] ?? "mayBeEmpty"}` };
    }
    return { name: `scan target ${t.glob}`, status: "FAIL", detail: "matches 0 files — the gate would scan nothing here" };
  });
  if (files.length === 0 && results.every((r) => r.status !== "FAIL")) {
    results.push({ name: "scan total", status: "FAIL", detail: "0 source files selected in this project" });
  }
  return results;
}

/**
 * Plants a canary violation inside the real project, runs the project's own
 * gate command, and requires it to exit non-zero. The canary is always removed.
 */
function gateCanary(root, config, command) {
  const rel = gateCanaryPath(root, config);
  if (!rel) {
    return { name: "gate canary", status: "FAIL", detail: `cannot place a canary inside include targets ${config.include.join(", ")}` };
  }
  const abs = join(root, rel);
  if (existsSync(abs)) {
    return { name: "gate canary", status: "FAIL", detail: `${rel} already exists — remove it and rerun` };
  }
  const cleanup = () => rmSync(abs, { force: true });
  const onSignal = () => {
    cleanup();
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  try {
    const content = rel.endsWith(".py")
      ? "# TODO canary planted by realitygate selftest\nVIBE_CANARY = 1\n"
      : "// TODO canary planted by realitygate selftest\nexport const vibeCanary = 1;\n";
    write(root, rel, content);
    const run = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const tail = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split(/\r?\n/).slice(-5).join(" | ");
    if (run.error) return { name: "gate canary", status: "FAIL", detail: `could not run "${command}": ${run.error.message}` };
    return run.status !== 0
      ? { name: "gate canary", status: "PASS", detail: `"${command}" went red (exit ${run.status}) on a planted violation in ${rel}` }
      : { name: "gate canary", status: "FAIL", detail: `"${command}" stayed GREEN with a planted violation in ${rel} — the gate is broken. Last output: ${tail}` };
  } finally {
    cleanup();
    process.removeListener("SIGINT", onSignal);
  }
}

/** A canary path that is inside the project's scan scope, in a language it scans. */
function gateCanaryPath(root, config) {
  const base = GATE_CANARY_NAME.replace(/\.ts$/, "");
  if (config.include.length === 0) {
    const dir = ["src", "app", "lib"].find((d) => existsSync(join(root, d)));
    return dir ? `${dir}/${GATE_CANARY_NAME}` : GATE_CANARY_NAME;
  }
  const inScope = compileGlobs(config.include);
  for (const glob of config.include) {
    const dir = staticPrefix(glob);
    const exts = /\.\{([^}]+)\}$/.exec(glob)?.[1].split(",") ?? [/\*\.([\w]+)$/.exec(glob)?.[1] ?? "ts"];
    for (const ext of exts) {
      const rel = dir ? `${dir}/${base}.${ext}` : `${base}.${ext}`;
      if (inScope(rel)) return rel;
    }
  }
  return null;
}

function synthesizePath(paths, id) {
  if (!paths || paths.length === 0) return `src/canary-${id.toLowerCase()}.ts`;
  const glob = paths[0];
  const candidate = glob
    .replace(/\*\*\//g, "")
    .replace(/\{([^,}]*)[^}]*\}/g, "$1")
    .replace(/\*\*/g, "canary")
    .replace(/\*/g, "canary")
    .replace(/\?/g, "x");
  const path = /\.[\w]+$/.test(candidate) ? candidate : `${candidate.replace(/\/$/, "")}/canary.ts`;
  return compileGlobs(paths)(path) ? path : null;
}

function write(root, rel, content) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
