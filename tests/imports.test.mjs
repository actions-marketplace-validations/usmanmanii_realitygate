import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { listFiles } from "../src/files.mjs";
import { buildImportResolver, extractImports, packageName } from "../src/imports.mjs";
import { makeProject } from "./helpers.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));

function resolver(files) {
  const p = makeProject(files);
  cleanups.push(p.cleanup);
  return buildImportResolver(p.dir, listFiles(p.dir));
}

describe("packageName", () => {
  test("scoped and deep imports", () => {
    assert.equal(packageName("@supabase/supabase-js"), "@supabase/supabase-js");
    assert.equal(packageName("@scope/pkg/sub/path"), "@scope/pkg");
    assert.equal(packageName("lodash/fp"), "lodash");
  });
});

describe("extractImports", () => {
  test("finds static, multi-line, side-effect, require and dynamic imports", () => {
    const src = [
      'import a from "alpha";',
      "import {",
      "  b,",
      '} from "beta";',
      'import "gamma/register";',
      'const d = require("delta");',
      'const e = await import("epsilon");',
      'export { f } from "zeta";',
      '// import x from "commented";',
      'const sql = `select * from "users"`;',
    ].join("\n");
    assert.deepEqual(
      extractImports(src).map((i) => `${i.specifier}@${i.line}`),
      ["alpha@1", "beta@4", "gamma/register@5", "delta@6", "epsilon@7", "zeta@8"],
    );
  });
});

describe("resolver", () => {
  test("declared deps, builtins, relative and aliases resolve; invented package does not", () => {
    const r = resolver({
      "package.json": { dependencies: { react: "18.3.1" }, devDependencies: { vitest: "2.0.0" } },
      "tsconfig.json": '{\n  // comments are allowed\n  "compilerOptions": { "paths": { "@app/*": ["./src/*"] }, },\n}\n',
      "src/a.ts": "",
    });
    for (const ok of ["react", "react/jsx-runtime", "vitest", "node:fs", "fs", "./x", "../y", "@/lib/db", "~/z", "@app/util", "#internal"]) {
      assert.equal(r.isDeclared("src/a.ts", ok), true, ok);
    }
    assert.equal(r.isDeclared("src/a.ts", "react-super-hooks-pro"), false);
  });

  test("monorepo: nearest package.json plus root, plus workspace package names", () => {
    const r = resolver({
      "package.json": { name: "root", devDependencies: { typescript: "5.6.0" } },
      "apps/web/package.json": { name: "@acme/web", dependencies: { next: "15.0.0" } },
      "apps/mobile/package.json": { name: "@acme/mobile", dependencies: { expo: "52.0.0" } },
      "packages/schemas/package.json": { name: "@acme/schemas" },
      "apps/web/src/page.ts": "",
    });
    assert.equal(r.isDeclared("apps/web/src/page.ts", "next/link"), true);
    assert.equal(r.isDeclared("apps/web/src/page.ts", "typescript"), true);
    assert.equal(r.isDeclared("apps/web/src/page.ts", "@acme/schemas"), true);
    assert.equal(r.isDeclared("apps/web/src/page.ts", "server-only"), true, "provided by next");
    assert.equal(r.isDeclared("apps/web/src/page.ts", "expo"), false, "declared only in a sibling app");
  });

  test("baseUrl lets top-level source dirs import bare", () => {
    const r = resolver({
      "package.json": { dependencies: {} },
      "tsconfig.json": { compilerOptions: { baseUrl: "src" } },
      "src/components/Button.tsx": "",
      "src/app.ts": "",
    });
    assert.equal(r.isDeclared("src/app.ts", "components/Button"), true);
  });
});
