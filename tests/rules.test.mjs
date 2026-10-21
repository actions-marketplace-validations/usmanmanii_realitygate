import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { DEFAULT_CONFIG } from "../src/config.mjs";
import { listFiles } from "../src/files.mjs";
import { insideRegexLiteral, scanFiles, selectSources } from "../src/scan.mjs";
import { FAKE_AWS_KEY, FAKE_STRIPE_KEY, makeProject } from "./helpers.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));

// R-018 (unwired code) judges a whole project: these one-file fixtures export
// names nothing imports by construction, so it is off here and tested on
// complete projects in unwired.test.mjs.
function scan(files, config = {}) {
  const p = makeProject(files);
  cleanups.push(p.cleanup);
  const cfg = { ...structuredClone(DEFAULT_CONFIG), disable: ["R-018"], ...config };
  const allFiles = listFiles(p.dir);
  const { files: sources } = selectSources(p.dir, cfg, allFiles);
  return scanFiles(p.dir, sources, cfg, { allFiles });
}

const rulesIn = (findings) => [...new Set(findings.map((f) => f.rule))].sort();

describe("line rules fire on real violations", () => {
  const cases = [
    ["R-001", "export const a = 1; // TODO: connect payments\n"],
    ["R-001", "# FIXME handle timeouts\nx = 1\n", "src/app.py"],
    ["R-002", 'export function pay() {\n  throw new Error("Not implemented yet");\n}\n'],
    ["R-003", 'export const hero = "Lorem ipsum dolor";\n'],
    ["R-004", "export const fee = 5; // hardcode for now\n"],
    ["R-004", "// in a real app we would call the API\nexport const x = 1;\n"],
    ["R-005", 'export const users = [{ name: "Jane Doe" }];\n'],
    ["R-005", "export const mockData = [1, 2, 3];\n"],
    ["R-005", 'export const owner = "admin@example.com";\n'],
    ["R-006", "// @ts-ignore\nexport const n: number = 1;\n"],
    ["R-007", "// eslint-disable-next-line no-console\nexport const q = 1;\n"],
    ["R-008", "export const parse = (v: any): string => String(v);\n"],
    ["R-008", "export const cast = (v: unknown) => v as any;\n"],
    ["R-009", 'export function f(): void {\n  console.log("debug");\n}\n'],
    ["R-010", "// return computeLegacy(order);\nexport const r = 1;\n"],
    ["R-011", `export const key = "${FAKE_AWS_KEY}";\n`],
    ["R-011", `export const stripe = "${FAKE_STRIPE_KEY}";\n`],
    ["R-012", "export const k = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;\n"],
    ["R-012", "export const k = import.meta.env.VITE_STRIPE_SECRET;\n"],
  ];
  for (const [id, content, path = "src/file.ts"] of cases) {
    test(`${id}: ${content.split("\n")[0].slice(0, 50)}`, () => {
      assert.ok(rulesIn(scan({ [path]: content })).includes(id));
    });
  }
});

describe("file rules", () => {
  test("R-013 empty catch block, multi-line", () => {
    const f = scan({ "src/a.ts": "export async function a() {\n  try {\n    await fetch('/');\n  } catch (err) {\n  }\n}\n" });
    assert.deepEqual(rulesIn(f), ["R-013"]);
    assert.equal(f[0].line, 4);
  });
  test("R-013 .catch(() => []) swallows", () => {
    assert.ok(rulesIn(scan({ "src/a.ts": "export const load = () => fetch('/').catch(() => []);\n" })).includes("R-013"));
  });
  test("R-013 python except: pass", () => {
    assert.ok(rulesIn(scan({ "src/a.py": "try:\n    run()\nexcept Exception:\n    pass\n" })).includes("R-013"));
  });
  test("R-013 does not flag a handled catch", () => {
    assert.ok(!rulesIn(scan({ "src/a.ts": "export async function a() {\n  try {\n    await fetch('/');\n  } catch (err) {\n    throw new Error('load failed', { cause: err });\n  }\n}\n" })).includes("R-013"));
  });
  test("R-015 route reading input without validation", () => {
    const f = scan({ "app/api/orders/route.ts": "export async function POST(req: Request) {\n  const body = await req.json();\n  return Response.json(body);\n}\n" });
    assert.ok(rulesIn(f).includes("R-015"));
  });
  test("R-015 express handler reading req.body without validation", () => {
    const f = scan({ "server/index.js": "app.post('/orders', (req, res) => {\n  res.json(req.body);\n});\n" });
    assert.ok(rulesIn(f).includes("R-015"));
  });
  test("R-015 passes when zod validates", () => {
    const f = scan({
      "app/api/orders/route.ts": 'import { z } from "zod";\nconst B = z.object({ id: z.string() });\nexport async function POST(req: Request) {\n  return Response.json(B.parse(await req.json()));\n}\n',
      "package.json": { dependencies: { zod: "3.23.8" } },
    });
    assert.deepEqual(rulesIn(f), []);
  });
  test("R-015: decoding with JSON.parse, qs.parse or URL parsers is not validation", () => {
    for (const decode of ["JSON.parse(await req.text())", "qs.parse(await req.text())", "JSON5.parse(await req.text())", "Object.fromEntries(new URLSearchParams(await req.text()))"]) {
      const f = scan({ "app/api/orders/route.ts": `export async function POST(req: Request) {\n  const body = ${decode};\n  return Response.json(body);\n}\n` });
      assert.ok(rulesIn(f).includes("R-015"), decode);
    }
  });
  test("R-015: a schema's .parse or .validate still counts, including chained and decoded-then-validated input", () => {
    for (const body of [
      "Order.parse(JSON.parse(await req.text()))",
      "z.object({ id: z.string() }).parse(await req.json())",
      "await orderSchema.validate(await req.json())",
      "schemas.order.safeParse(await req.json())",
    ]) {
      const f = scan({ "app/api/orders/route.ts": `export async function POST(req: Request) {\n  const body = ${body};\n  return Response.json(body);\n}\n` });
      assert.ok(!rulesIn(f).includes("R-015"), body);
    }
  });
  test("R-015: a decoder under another name is still not validation", () => {
    for (const [setup, call] of [
      ["const p = JSON;", "p.parse(await req.text())"],
      ["const a = JSON;\nconst b = a;", "b.parse(await req.text())"],
      ['import * as y from "yaml";', "y.parse(await req.text())"],
      ['import jsYaml from "js-yaml";', "jsYaml.load(await req.text())"],
      ['const q = require("qs");', "q.parse(await req.text())"],
    ]) {
      const f = scan({ "app/api/orders/route.ts": `${setup}\nexport async function POST(req: Request) {\n  const body = ${call};\n  return Response.json(body);\n}\n` });
      assert.ok(rulesIn(f).includes("R-015"), setup);
    }
  });
  test("R-015: a schema held under another name still counts", () => {
    for (const [setup, call] of [
      ["const S = Order;", "S.parse(await req.json())"],
      ['import Order from "./schemas/order";', "Order.parse(await req.json())"],
      ['import * as schemas from "./schemas";', "schemas.order.parse(await req.json())"],
    ]) {
      const f = scan({ "app/api/orders/route.ts": `${setup}\nexport async function POST(req: Request) {\n  const body = ${call};\n  return Response.json(body);\n}\n` });
      assert.ok(!rulesIn(f).includes("R-015"), setup);
    }
  });
  test("R-015 (Python): json under another name is not validation; a marshmallow schema is", () => {
    const route = (setup, call) => `${setup}\nfrom flask import Flask, request\napp = Flask(__name__)\n\n@app.post("/orders")\ndef create():\n    data = ${call}\n    return data\n`;
    for (const [setup, call] of [["import json as j", "j.load(request.data)"], ["import json\nloader = json", "loader.load(request.data)"]]) {
      assert.ok(rulesIn(scan({ "app/routes.py": route(setup, call) })).includes("R-015"), setup);
    }
    assert.ok(!rulesIn(scan({ "app/routes.py": route("from app.schemas import OrderSchema\nschema = OrderSchema()", "schema.load(request.json)") })).includes("R-015"));
  });
  test("R-015 treats a verified webhook signature as validation", () => {
    const f = scan({
      "app/api/webhooks/stripe/route.ts":
        'import Stripe from "stripe";\nconst stripe = new Stripe("k");\nexport async function POST(request: Request) {\n  const payload = await request.text();\n  const sig = request.headers.get("stripe-signature") as string;\n  const event = stripe.webhooks.constructEvent(payload, sig, "whsec");\n  return Response.json({ type: event.type });\n}\n',
      "package.json": { dependencies: { stripe: "17.0.0" } },
    });
    assert.deepEqual(rulesIn(f), []);
  });
  test("R-016 flags another module's repo, allows its own", () => {
    const f = scan({
      "src/modules/billing/service.ts": 'import { find } from "../../modules/users/repo";\nimport { save } from "../../modules/billing/repo";\nexport const x = [find, save];\n',
    });
    assert.equal(f.filter((x) => x.rule === "R-016").length, 1);
  });
  test("R-022 catches null-only service methods even behind a feature flag", () => {
    const f = scan({
      "src/modules/billing/service.ts": "export async function charge(): Promise<Receipt | null> {\n  return null;\n}\n",
      "src/payment.service.ts": "export class PaymentService {\n  async charge(): Promise<Receipt | null> {\n    return null;\n  }\n}\n",
      "src/services/receipt.ts": "export const issueReceipt = async (id: string) => {\n  return null;\n};\n",
      "src/services/preview.ts": "export const preview = (id: string) => null;\n",
      "src/features.ts": "export const billingEnabled = false;\n",
    });
    assert.equal(f.filter((x) => x.rule === "R-022").length, 4);
  });
  test("R-022 leaves real nullable service flows and non-service files alone", () => {
    const f = scan({
      "src/modules/billing/service.ts": "export async function charge(id: string) {\n  if (!id) return null;\n  return saveCharge(id);\n}\n",
      "src/services/order.ts": "export function find(id: string) {\n  return orders.get(id) ?? null;\n}\n",
      "src/dashboard.ts": "export function emptyState() {\n  return null;\n}\n",
      "src/services/help.ts": "export const example = `\nfunction fake() { return null; }\n`;\n// function commented() { return null; }\n",
    });
    assert.ok(!rulesIn(f).includes("R-022"));
  });
});

describe("no false positives on legitimate code", () => {
  test("todo app identifiers and lowercase words are not placeholders", () => {
    const f = scan({ "src/todos.ts": "export type Todo = { id: string; done: boolean };\nexport const todoList: Todo[] = [];\nexport const fixmeCount = 0;\n" });
    assert.deepEqual(rulesIn(f), []);
  });
  test("justified: comment allows ts-ignore / any / eslint-disable", () => {
    const f = scan({ "src/a.ts": "// @ts-expect-error justified: upstream types omit `cause`\nexport const n = 1;\nexport const v = (x: any) => x; // justified: JSON boundary, validated below\n" });
    assert.deepEqual(rulesIn(f), []);
  });
  test("regex literals defining forbidden words are not placeholders", () => {
    const f = scan({ "src/lint.ts": 'export const RULES = [[/\\bTODO\\b|not implemented/i, "stub"], [/lorem ipsum/i, "copy"]];\n' });
    assert.deepEqual(rulesIn(f), []);
  });
  test("console.log in scripts/ and bin/ is allowed", () => {
    const f = scan({
      "scripts/migrate.ts": 'console.log("done");\n',
      "bin/cli.js": 'console.log("hi");\n',
      "lib/db/setup.ts": 'console.log("Docker is installed.");\n',
      "lib/db/seed.ts": 'console.log("seeded");\nexport const users = [{ name: "John Doe" }];\n',
    });
    assert.deepEqual(rulesIn(f), []);
  });
  test("tests are never scanned as app code", () => {
    const f = scan({ "src/a.test.ts": "// TODO x\nconst mockData = 1;\n", "tests/b.ts": "// FIXME\n", "src/ok.ts": "export const ok = 1;\n" });
    assert.deepEqual(rulesIn(f), []);
  });
  test("insideRegexLiteral distinguishes comments from regex", () => {
    assert.equal(insideRegexLiteral("const r = /TODO/;", 11), true);
    assert.equal(insideRegexLiteral("const r = 1; // TODO later", 16), false);
  });
});

describe("custom rules from config", () => {
  test("line rule with paths applies only to matching files", () => {
    const re = /\bUPDATE\s+ledger_entries\b/i;
    const rules = [{ id: "HC-1", label: "ledger is append-only", re, paths: ["src/**/repo.ts"], severity: "error", custom: true }];
    const f = scan(
      { "src/ledger/repo.ts": 'export const q = "UPDATE ledger_entries SET x = 1";\n', "src/other.ts": 'export const q = "UPDATE ledger_entries SET x = 1";\n' },
      { rules },
    );
    assert.deepEqual(f.map((x) => `${x.rule}:${x.file}`), ["HC-1:src/ledger/repo.ts"]);
  });
  test("disable turns a rule off", () => {
    assert.deepEqual(rulesIn(scan({ "src/a.ts": 'export function f(): void {\n  console.log("x");\n}\n' }, { disable: ["R-009", "R-018"] })), []);
  });
});
