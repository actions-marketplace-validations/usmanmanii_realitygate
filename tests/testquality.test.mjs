import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { runAudit } from "../src/audit.mjs";
import { runCheck } from "../src/check.mjs";
import { fakeTests, hasAssertion, isRealTestFile, skippedTests } from "../src/testquality.mjs";
import { makeProject } from "./helpers.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));
const project = (files) => {
  const p = makeProject(files);
  cleanups.push(p.cleanup);
  return p.dir;
};
const lines = (hits) => hits.map((h) => h.line);
const VITEST = 'import { expect, test } from "vitest";\n';

describe("R-019 tests that can't fail", () => {
  test("empty JS/TS test bodies are flagged, including async, function and comment-only bodies", () => {
    const f = VITEST + 'test("a", () => {});\nit("b", async () => {\n});\ntest("c", function () {\n  // later\n});\ntest.only("d", () => {});\ntest("real", () => {\n  expect(1 + 1).toBe(2);\n});\n';
    assert.deepEqual(lines(fakeTests("src/a.test.ts", f)), [2, 3, 5, 8]);
  });

  test("always-true assertions are flagged", () => {
    const f = VITEST + 'test("x", () => {\n  expect(true).toBe(true);\n  expect(1).toEqual(1);\n  expect("ok").toBeTruthy();\n  expect(false).toBeFalsy();\n  expect(sum(1, 1)).toBe(2);\n});\n';
    assert.deepEqual(lines(fakeTests("src/a.test.ts", f)), [3, 4, 5, 6]);
    const nodeTest = 'import assert from "node:assert";\nimport { test } from "node:test";\ntest("x", () => {\n  assert.ok(true);\n  assert.equal(1, 1);\n  assert.strictEqual(sum(1, 1), 2);\n});\n';
    assert.deepEqual(lines(fakeTests("tests/a.test.mjs", nodeTest)), [4, 5]);
  });

  test("committed .only, fit and fdescribe are flagged", () => {
    const f = VITEST + 'describe.only("s", () => {\n  it.only("a", () => {\n    expect(f()).toBe(1);\n  });\n  fit("b", () => {\n    expect(f()).toBe(1);\n  });\n});\n';
    assert.deepEqual(lines(fakeTests("src/a.spec.ts", f)), [2, 3, 6]);
  });

  test("a file whose tests contain no assertion at all is flagged once, unless justified", () => {
    const smoke = 'import { render } from "./r";\ntest("renders", () => {\n  render("<App />");\n});\ntest("again", () => {\n  render("<App />");\n});\n';
    assert.deepEqual(fakeTests("src/app.test.tsx", smoke).map((h) => [h.line, h.text]), [[2, "2 tests and no assertion anywhere in the file"]]);
    assert.deepEqual(fakeTests("src/app.test.tsx", smoke.replace('test("renders", () => {', 'test("renders", () => { // justified: smoke test, render throws on error')), []);
  });

  test("one asserting test no longer hides a sibling with no assertion (a warning, per test)", () => {
    const f = VITEST + 'import { add } from "../src/add";\ntest("adds", () => {\n  expect(add(1, 2)).toBe(3);\n});\ntest("adds again", () => {\n  const r = add(2, 2);\n});\nit("async() with no space", async() => {\n  const r = add(1, 1);\n  setTimeout(() => {\n    console.log(r);\n  });\n});\n';
    const hits = fakeTests("src/add.test.ts", f);
    assert.deepEqual(hits.map((h) => [h.line, h.severity]), [[6, "warn"], [9, "warn"]]);
    assert.match(hits[0].text, /no assertion \(other tests in the file do\)/);
    const py = "from app.calc import add\n\ndef test_adds():\n    assert add(1, 2) == 3\n\ndef test_adds_again():\n    add(2, 2)\n";
    assert.deepEqual(fakeTests("tests/test_calc.py", py).map((h) => h.line), [6]);
    const go = "package calc\n\nimport \"testing\"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(1, 2) != 3 {\n\t\tt.Fatal(\"bad\")\n\t}\n}\n\nfunc TestAddAgain(t *testing.T) {\n\tAdd(2, 2)\n}\n";
    assert.deepEqual(fakeTests("calc/calc_test.go", go).map((h) => h.line), [11]);
  });

  test("reading one file doesn't change what is found in the next (shared regex state)", () => {
    const noAssert = "def test_a():\n    run()\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n";
    const nested = "def test_outer():\n    class T:\n        def test_inner(self):\n            return True\n    assert T().test_inner()\n\ndef test_other():\n    assert 1 + 1 == 2\n";
    const before = fakeTests("tests/test_n.py", nested);
    fakeTests("tests/test_a.py", noAssert);
    assert.deepEqual(fakeTests("tests/test_n.py", nested), before);
    assert.deepEqual(before, []);
  });

  test("per test: helpers, throws, awaits, the test's own parameters and e2e suites count as a way to fail", () => {
    const sibling = 'test("real", () => {\n  expect(f()).toBe(1);\n});\n';
    for (const body of [
      "  checkOrder(order);", // named like an assertion helper
      "  run(order);\n}\nfunction run(o) {\n  expect(o).toBeTruthy();", // a helper defined in the file
      "  SortTester.testSort(sort);", // a local test-support module
      '  if (f() !== 1) throw new Error("bad");',
      "  await client.orders.create(order);", // awaited work rejects
      '  server.get("/", done);', // the test's own parameter
      "  eq(f(), 1);", // an assertion imported under another name
    ]) {
      const head = 'import { strictEqual as eq } from "node:assert";\nimport { SortTester } from "../SortTester";\n';
      const fn = body.includes("done") ? "(done) =>" : "async () =>";
      const f = `${VITEST}${head}${sibling}test("other", ${fn} {\n${body}\n});\n`;
      assert.deepEqual(fakeTests("src/a.test.ts", f), [], body);
    }
    const noAssert = `${VITEST}${sibling}test("other", () => {\n  page.goto("/");\n  listing.itemExist("x");\n});\n`;
    assert.deepEqual(fakeTests("cypress/e2e/list.spec.ts", noAssert.replace("  page.goto(\"/\");\n", "")), []);
    const py = "def test_a():\n    assert f() == 1\n\ndef test_b(client):\n    client.get('/')\n\ndef test_c(self):\n    self.check_order()\n\nasync def test_d():\n    class T:\n        def test1(self):\n            return True\n    assert T().test1()\n";
    assert.deepEqual(fakeTests("tests/test_x.py", py), []);
  });

  test("Python: pass/.../docstring-only bodies and literal asserts are flagged", () => {
    const f = 'def test_a():\n    pass\n\n\ndef test_b() -> None:\n    """Later."""\n\n\nclass TestC:\n    def test_c(self):\n        ...\n\n    def test_d(self):\n        assert True\n\n    def test_e(self):\n        self.assertEqual(1, 1)\n\n\ndef test_real():\n    assert add(1, 1) == 2\n';
    assert.deepEqual(lines(fakeTests("tests/test_x.py", f)), [1, 5, 10, 14, 17]);
  });

  test("Go: an empty Test function is flagged", () => {
    const f = 'package x\n\nimport "testing"\n\nfunc TestA(t *testing.T) {\n}\n\nfunc TestB(t *testing.T) {\n\tif Add(1, 1) != 2 {\n\t\tt.Fatal("want 2")\n\t}\n}\n';
    assert.deepEqual(lines(fakeTests("x/a_test.go", f)), [5]);
  });

  test("real tests are not flagged", () => {
    const js = VITEST + 'test("adds", () => {\n  expect(add(1, 1)).toBe(2);\n});\ntest("throws", async () => {\n  await expect(load()).rejects.toThrow();\n});\ntest.todo("later");\n';
    assert.deepEqual(fakeTests("src/a.test.ts", js), []);
    const rtl = 'import { render, screen } from "@testing-library/react";\ntest("shows", () => {\n  render("<App />");\n  screen.getByText("hi");\n});\n';
    assert.deepEqual(fakeTests("src/a.test.tsx", rtl), []);
    const py = "import pytest\n\n\ndef test_raises():\n    with pytest.raises(ValueError):\n        parse('x')\n\n\ndef test_mock(m):\n    run(m)\n    m.assert_called_once()\n";
    assert.deepEqual(fakeTests("tests/test_x.py", py), []);
    const go = 'package x\n\nimport "testing"\n\nfunc TestA(t *testing.T) {\n\tif err := Run(); err != nil {\n\t\tt.Errorf("run: %v", err.Error())\n\t}\n}\n';
    assert.deepEqual(fakeTests("x/a_test.go", go), []);
  });

  test("a test written inside a one-line string (a fixture in another test) is not a test", () => {
    const f = 'import assert from "node:assert";\nconst fixture = { "a.test.ts": \'test("x", () => {});\\nexpect(true).toBe(true);\\n\' };\ntest("uses it", () => {\n  assert.ok(load(fixture));\n});\n';
    assert.deepEqual(fakeTests("tests/a.test.mjs", f), []);
  });

  test("only real test files are read: fixtures, mocks and source files are not", () => {
    assert.equal(isRealTestFile("src/a.test.ts"), true);
    assert.equal(isRealTestFile("tests/test_a.py"), true);
    assert.equal(isRealTestFile("pkg/a_test.go"), true);
    assert.equal(isRealTestFile("tests/fixtures/empty.test.ts"), false);
    assert.equal(isRealTestFile("src/__mocks__/api.ts"), false);
    assert.equal(isRealTestFile("src/a.ts"), false);
    assert.deepEqual(fakeTests("src/a.ts", 'test("a", () => {});\n'), []);
  });

  test("hasAssertion recognises each language's assertions", () => {
    assert.equal(hasAssertion("a.test.ts", "expect(x).toBe(1)"), true);
    assert.equal(hasAssertion("a.test.ts", "render(x)"), false);
    assert.equal(hasAssertion("test_a.py", "    assert x == 1"), true);
    assert.equal(hasAssertion("a_test.go", "t.Fatalf(\"x\")"), true);
    assert.equal(hasAssertion("a_test.go", "return err.Error()"), false);
  });
});

describe("R-020 skipped tests", () => {
  test("unconditional skips are flagged in JS/TS, Python and Go", () => {
    const js = VITEST + 'test.skip("a", () => {\n  expect(f()).toBe(1);\n});\nxit("b", () => {\n  expect(f()).toBe(1);\n});\ntest("c", { skip: true }, () => {\n  expect(f()).toBe(1);\n});\n';
    assert.deepEqual(lines(skippedTests("src/a.test.ts", js)), [2, 5, 8]);
    const py = '@pytest.mark.skip(reason="flaky")\ndef test_a():\n    assert f() == 1\n\n\n@unittest.skip("later")\ndef test_b():\n    assert f() == 1\n';
    assert.deepEqual(lines(skippedTests("tests/test_a.py", py)), [1, 6]);
    const go = 'package x\n\nimport "testing"\n\nfunc TestA(t *testing.T) {\n\tt.Skip("later")\n\tif f() != 1 {\n\t\tt.Fatal("x")\n\t}\n}\n';
    assert.deepEqual(lines(skippedTests("x/a_test.go", go)), [5]);
  });

  test("conditional skips, todos and justified skips are not flagged", () => {
    const js = VITEST + 'test.skipIf(process.platform === "win32")("a", () => {\n  expect(f()).toBe(1);\n});\ntest.todo("b");\ntest.skip("c", () => { // justified: upstream bug #12\n  expect(f()).toBe(1);\n});\n';
    assert.deepEqual(skippedTests("src/a.test.ts", js), []);
    const py = '@pytest.mark.skipif(sys.platform == "win32", reason="posix only")\ndef test_a():\n    assert f() == 1\n';
    assert.deepEqual(skippedTests("tests/test_a.py", py), []);
    const go = 'package x\n\nimport "testing"\n\nfunc TestA(t *testing.T) {\n\tif testing.Short() {\n\t\tt.Skip("slow")\n\t}\n\tif f() != 1 {\n\t\tt.Fatal("x")\n\t}\n}\n';
    assert.deepEqual(skippedTests("x/a_test.go", go), []);
  });
});

describe("test-quality rules in check and audit", () => {
  const app = { "package.json": { name: "x", scripts: { test: "vitest run" } }, "src/sum.ts": "export const sum = (a: number, b: number): number => a + b;\n" };

  test("check fails on a test that can't fail and only warns on a skip, and reports the test files it read", () => {
    const fake = runCheck(project({ ...app, "src/sum.test.ts": VITEST + 'test("sum", () => {\n  expect(true).toBe(true);\n});\n' }));
    assert.equal(fake.ok, false);
    assert.deepEqual(fake.errors.map((e) => `${e.rule} ${e.file}:${e.line}`), ["R-019 src/sum.test.ts:3"]);
    assert.equal(fake.testFilesScanned, 1);

    const skipped = runCheck(project({ ...app, "src/sum.test.ts": VITEST + 'import { sum } from "./sum";\ntest.skip("sum", () => {\n  expect(sum(1, 1)).toBe(2);\n});\n' }));
    assert.equal(skipped.ok, true);
    assert.deepEqual(skipped.warnings.filter((w) => w.rule === "R-020").map((w) => `${w.file}:${w.line}`), ["src/sum.test.ts:3"]);
  });

  test("test fixtures and excluded paths are not read", () => {
    const r = runCheck(project({ ...app, "tests/fixtures/fake.test.ts": 'test("a", () => {});\n', "realitygate.config.json": { exclude: [{ glob: "legacy/**", reason: "old suite, being replaced" }] }, "legacy/old.test.ts": 'test("a", () => {});\n' }));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.testFilesScanned, 0);
  });

  test("the audit counts test files with assertions and charges R-019 to the Tests category", () => {
    const dir = project({
      ...app,
      "src/sum.test.ts": VITEST + 'test("sum", () => {\n  expect(sum(1, 1)).toBe(2);\n});\n',
      "src/empty.test.ts": 'test("nothing", () => {});\n',
    });
    const r = runAudit(dir);
    assert.deepEqual([r.stats.testFiles, r.stats.testFilesWithAssertions], [2, 1]);
    const tests = r.categories.find((c) => c.id === "tests");
    assert.ok(tests.items.some((i) => i.finding?.rule === "R-019"));
  });
});
