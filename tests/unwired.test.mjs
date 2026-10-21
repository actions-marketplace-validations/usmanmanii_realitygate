import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { runCheck } from "../src/check.mjs";
import { DEFAULT_CONFIG } from "../src/config.mjs";
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

function unwired(files) {
  const dir = project(files);
  const cfg = structuredClone(DEFAULT_CONFIG);
  const allFiles = listFiles(dir);
  const { files: sources } = selectSources(dir, cfg, allFiles);
  return scanFiles(dir, sources, cfg, { allFiles })
    .filter((f) => f.rule === "R-018")
    .map((f) => `${f.file}:${f.line} ${f.text}`);
}

const APP = {
  "package.json": { name: "app", private: true },
  "src/index.ts": 'import { total } from "./orders";\nexport const run = () => total([1, 2]);\n',
};

describe("R-018 unwired code", () => {
  test("flags an exported function nothing imports or calls", () => {
    const f = unwired({ ...APP, "src/orders.ts": "export function total(xs: number[]): number {\n  return xs.reduce((a, b) => a + b, 0);\n}\nexport function refund(id: string): string {\n  return id;\n}\n" });
    assert.deepEqual(f, ["src/orders.ts:4 `refund` is exported but nothing imports or calls it"]);
  });

  test("flags an exported component, const and class, and says when only tests use it", () => {
    const f = unwired({
      ...APP,
      "src/orders.ts": "export const total = (xs: number[]) => xs.length;\n",
      "src/components/Banner.tsx": "export function Banner() {\n  return null;\n}\n",
      "src/lib/money.ts": "export class Money {}\nexport const ZERO = 0;\n",
      "tests/money.test.ts": 'import { Money } from "../src/lib/money";\nnew Money();\n',
    });
    assert.deepEqual(f, [
      "src/components/Banner.tsx:1 `Banner` is exported but nothing imports or calls it",
      "src/lib/money.ts:1 `Money` is exported but only tests use it",
      "src/lib/money.ts:2 `ZERO` is exported but nothing imports or calls it",
    ]);
  });

  test("flags a name exported through an export list", () => {
    const f = unwired({ ...APP, "src/orders.ts": "const total = (xs: number[]) => xs.length;\nconst legacy = () => 0;\nexport { total, legacy as oldTotal };\n" });
    assert.deepEqual(f, ["src/orders.ts:3 `oldTotal` is exported but nothing imports or calls it"]);
  });

  test("used through an import, a re-export, HTML or JSON counts as wired", () => {
    const f = unwired({
      ...APP,
      "src/orders.ts": "export const total = (xs: number[]) => xs.length;\n",
      "src/lib/a.ts": "export const shared = 1;\n",
      "src/lib/barrel.ts": 'export { shared } from "./a";\n',
      "src/widgets/clock.ts": "export function mountClock() {}\n",
      "public/index.html": '<script type="module">import { mountClock } from "/src/widgets/clock.ts"; mountClock();</script>\n',
    });
    assert.deepEqual(f, []);
  });

  test("an export used inside its own file is not flagged", () => {
    const f = unwired({ ...APP, "src/orders.ts": "export const rate = 2;\nexport const total = (xs: number[]) => xs.length * rate;\n" });
    assert.deepEqual(f, []);
  });

  test("framework entry files and convention exports are never flagged", () => {
    const f = unwired({
      ...APP,
      "src/orders.ts": "export const total = (xs: number[]) => xs.length;\n",
      "app/dashboard/page.tsx": "export default function Page() {\n  return null;\n}\nexport const metadata = { title: 'x' };\nexport function Helper() {}\n",
      "app/api/orders/route.ts": "export async function GET() {\n  return Response.json([]);\n}\n",
      "src/app/layout.tsx": "export const viewport = {};\nexport default function Root() {}\n",
      "middleware.ts": "export function middleware() {}\nexport const config = { matcher: [] };\n",
      "pages/about.tsx": "export function getStaticProps() {}\nexport default function About() {}\n",
      "app/routes/home.tsx": "export function loader() {}\nexport function meta() {}\n",
      "src/routes/+page.server.ts": "export function load() {}\nexport const actions = {};\n",
      "bin/cli.ts": "export function main() {}\n",
      "scripts/seed-db.ts": "export function seed() {}\n",
      "src/main.tsx": "export function boot() {}\n",
      "src/Button.stories.tsx": "export const Primary = {};\n",
      "src/components/ui/accordion.tsx": "export function Accordion() {}\n",
      "src/lib/route-helpers.ts": "export async function POST() {}\n",
    });
    assert.deepEqual(f, []);
  });

  test("files named in package.json (main, exports, bin, scripts) are entry points", () => {
    const f = unwired({
      "package.json": { name: "lib", main: "./src/lib.ts", bin: { tool: "tools/run.js" }, scripts: { gen: "node tools/gen.mjs" } },
      "src/lib.ts": "export function publicApi() {}\n",
      "tools/run.js": "export function cli() {}\n",
      "tools/gen.mjs": "export function generate() {}\n",
    });
    assert.deepEqual(f, []);
  });

  test("a package that exports \"./*\" turns the rule off (any file is public)", () => {
    const f = unwired({ "package.json": { name: "lib", exports: { ".": "./src/index.ts", "./*": "./src/*.ts" } }, "src/math.ts": "export function add() {}\n" });
    assert.deepEqual(f, []);
  });

  test("type exports, default exports, multi-line export lists and justified lines are skipped", () => {
    const f = unwired({
      ...APP,
      "src/orders.ts": "export const total = (xs: number[]) => xs.length;\n",
      "src/types.ts": "export type Order = { id: string };\nexport interface Line { sku: string }\nexport default function x() {}\n",
      "src/keep.ts": "export function hook() {} // justified: loaded by the plugin host by name\n",
    });
    assert.deepEqual(f, []);
  });

  test("it is a warning: the gate stays green", () => {
    const dir = project({ ...APP, "src/orders.ts": "export const total = (xs: number[]) => xs.length;\nexport const unused = 1;\n" });
    const r = runCheck(dir);
    assert.equal(r.ok, true);
    assert.ok(r.warnings.some((w) => w.rule === "R-018"));
  });
});
