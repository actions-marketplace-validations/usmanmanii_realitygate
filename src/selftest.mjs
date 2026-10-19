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
import { scanFiles, selectSources } from "./scan.mjs";

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
    content: "export async function POST(request: Request): Promise<Response> {\n  const body = await request.json();\n  return Response.json(body);\n}\n",
  },
  "R-016": {
    path: "src/modules/billing/service.ts",
    content: 'import { findUser } from "../../modules/users/repo";\nexport const u = findUser;\n',
  },
};

// Real, clean code: must produce ZERO findings (false-positive canary).
const CLEAN = {
  "src/clean.ts":
    'import { z } from "zod";\nimport { readFileSync } from "node:fs";\n\nconst Input = z.object({ path: z.string() });\n\nexport function load(raw: unknown): string {\n  const { path } = Input.parse(raw);\n  return readFileSync(path, "utf8");\n}\n',
  "app/api/ok/route.ts":
    'import { z } from "zod";\n\nconst Body = z.object({ name: z.string() });\n\nexport async function POST(request: Request): Promise<Response> {\n  const body = Body.parse(await request.json());\n  return Response.json(body);\n}\n',
  "package.json": JSON.stringify({ name: "vibe-canary", dependencies: { zod: "3.23.8" } }, null, 2),
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

    for (const [id, canary] of Object.entries(CANARIES)) {
      if (disabled.has(id)) {
        results.push({ name: `${id} canary`, status: "WARN", detail: "rule disabled in config — not verified" });
        continue;
      }
      const path = canary.path ?? `src/canary-${id.toLowerCase()}.ts`;
      write(dir, path, canary.content);
      expected.set(path, id);
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
      expected.set(path, rule.id);
    }
    for (const [path, content] of Object.entries(CLEAN)) write(dir, path, content);

    const allFiles = listFiles(dir);
    const { files } = selectSources(dir, config, allFiles);
    const findings = scanFiles(dir, files, config, { allFiles });

    for (const [path, id] of expected) {
      const fired = findings.some((f) => f.file === path && f.rule === id);
      results.push({
        name: `${id} canary`,
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
