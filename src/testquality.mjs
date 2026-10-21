// Tests that can't fail. RealityGate's Tests category used to count test
// files, so `test("x", () => {})` or `expect(true).toBe(true)` looked as
// healthy as a real test. These checks read test files only: R-019 for tests
// that cannot fail (and committed `.only`, which silently drops the rest of
// the suite), R-020 for committed unconditional skips.
//
// Every pattern is anchored at the start of a line, so a test written inside a
// one-line string (a fixture in another test) is not mistaken for a real one.

import { isTestFile } from "./files.mjs";

const JS = /\.[cm]?[jt]sx?$/;
const PY = /\.py$/;
const GO = /\.go$/;
// Folders that hold test data and doubles, not tests.
const NOT_TESTS = /(?:^|\/)(?:__mocks__|__fixtures__|fixtures?|__snapshots__|testdata)\//;

/** A file that holds tests (as opposed to fixtures, mocks or snapshots). */
export function isRealTestFile(path) {
  return /\.(?:[cm]?[jt]sx?|py|go)$/.test(path) && isTestFile(path) && !NOT_TESTS.test(path);
}

const JS_STR = String.raw`(?:"[^"\n]*"|'[^'\n]*'|` + "`[^`\\n]*`" + ")";
const JS_LIT = String.raw`(?:true|false|null|undefined|-?\d+(?:\.\d+)?|"[^"\n]*"|'[^'\n]*')`;
const JS_EMPTY_BODY = String.raw`\{(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*\}`;
const JS_FN = String.raw`(?:async\s+)?(?:\(\s*[\w$,{}\s]*\)|[\w$]+)\s*=>\s*` + JS_EMPTY_BODY + String.raw`|(?:async\s+)?function\s*[\w$]*\s*\([^)]*\)\s*` + JS_EMPTY_BODY;
const JS_TEST_CALL = /^[ \t]*(?:it|test)(?:\.(?:only|concurrent|serial))?\s*\(/gm;

const JS_RULES = [
  { re: new RegExp(String.raw`^[ \t]*(?:it|test)(?:\.(?:only|concurrent|serial))?\s*\(\s*${JS_STR}\s*,\s*(?:${JS_FN})\s*\)`, "gm"), why: "empty test body" },
  { re: new RegExp(String.raw`^[ \t]*(?:await\s+)?expect\(\s*(${JS_LIT})\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual|to\.equal|to\.eql|to\.deep\.equal)\s*\(\s*\1\s*\)`, "gm"), why: "asserts a literal equals itself" },
  { re: /^[ \t]*(?:await\s+)?expect\(\s*(?:true|-?[1-9]\d*|"[^"\n]+"|'[^'\n]+')\s*\)\s*\.\s*(?:toBeTruthy|toBeDefined|to\.be\.true|to\.be\.ok|to\.exist)\b/gm, why: "asserts a literal is truthy" },
  { re: /^[ \t]*(?:await\s+)?expect\(\s*(?:false|null|0)\s*\)\s*\.\s*(?:toBeFalsy|to\.be\.false|to\.not\.be\.ok)\b/gm, why: "asserts a literal is falsy" },
  { re: /^[ \t]*(?:assert(?:\.ok|\.isTrue)?|t\.(?:ok|true|truthy|assert))\s*\(\s*true\s*[,)]/gm, why: "asserts true" },
  { re: new RegExp(String.raw`^[ \t]*(?:assert|t)\.(?:equal|strictEqual|deepEqual|deepStrictEqual|is|same)\s*\(\s*(${JS_LIT})\s*,\s*\1\s*[,)]`, "gm"), why: "asserts a literal equals itself" },
  { re: /^[ \t]*(?:it|test|describe|context|suite)\.only\s*\(|^[ \t]*f(?:it|describe)\s*\(|^[ \t]*(?:it|test|describe|suite)\s*\([^\n]*\{\s*only\s*:\s*true\b/gm, why: "committed .only: the rest of the suite does not run" },
];
const JS_SKIPS = /^[ \t]*(?:it|test|describe|context|suite)\.skip\s*\(|^[ \t]*x(?:it|test|describe|context)\s*\(|^[ \t]*(?:it|test|describe|suite)\s*\([^\n]*\{\s*skip\s*:\s*true\b/gm;
const JS_ASSERTS = /\bexpect\w*\s*[.(]|\bassert\w*\s*[.(]|\.should\b|\bshould\s*[.(]|\bt\.(?:is|not|true|false|truthy|falsy|deepEqual|equal|ok|notOk|throws|rejects|doesNotThrow|assert|same|match|snapshot|plan|pass|fail|strictEqual|deepStrictEqual|regex)\w*\s*\(|\b(?:get|find)(?:All)?By[A-Z]\w*\s*\(|\bcy\.\w+|\bsinon\.assert\b|\.expect\s*\(|\bstrictEqual\s*\(|\bdeepStrictEqual\s*\(/;

const PY_LIT = String.raw`(?:True|False|None|-?\d+(?:\.\d+)?|"[^"\n]*"|'[^'\n]*')`;
const PY_RULES = [
  { re: /^[ \t]*assert\s+(?:True|[1-9]\d*|"[^"\n]+"|'[^'\n]+')\s*(?:,[^\n]*)?(?:#[^\n]*)?$/gm, why: "asserts a literal is true" },
  { re: new RegExp(String.raw`^[ \t]*assert\s+(${PY_LIT})\s*==\s*\1\s*(?:,[^\n]*)?(?:#[^\n]*)?$`, "gm"), why: "asserts a literal equals itself" },
  { re: /^[ \t]*self\.assertTrue\(\s*True\s*[,)]/gm, why: "asserts True" },
  { re: new RegExp(String.raw`^[ \t]*self\.assert(?:Equal|Equals)\(\s*(${PY_LIT})\s*,\s*\1\s*[,)]`, "gm"), why: "asserts a literal equals itself" },
];
const PY_SKIPS = /^[ \t]*@(?:pytest\.mark\.skip|unittest\.skip)\b(?![A-Za-z])/gm;
const PY_TEST_DEF = /^([ \t]*)(?:async\s+)?def\s+(test\w*)\s*\(/gm;
const PY_ASSERTS = /^[ \t]*assert\b|\bself\.assert\w+\s*\(|\bself\.fail\s*\(|\bpytest\.(?:raises|warns|approx|fail)\b|\.assert_\w+\s*\(|\bassert_\w+\s*\(/m;

const GO_RULES = [
  { re: /^func\s+(Test\w*)\s*\(\s*\w+\s+\*testing\.T\s*\)\s*\{\s*\}/gm, why: "empty test body" },
];
const GO_SKIPS = /^func\s+Test\w*\s*\(\s*(\w+)\s+\*testing\.T\s*\)\s*\{\s*\1\.Skip(?:f|Now)?\(/gm;
const GO_TEST_FUNC = /^func\s+Test\w*\s*\(\s*\w+\s+\*testing\.T\s*\)/gm;
// `t.Error(` reports a failure; `err.Error()` only formats one, so the receiver must be the testing handle.
const GO_ASSERTS = /\b(?:t|tt|tb|b|f)\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(|\b(?:assert|require)\.\w+\s*\(|\bExpect\s*\(|\bcmp\.Diff\b|\bt\.Run\s*\(/;

const lineAt = (content, index) => content.slice(0, index).split("\n").length;
const lineText = (content, line) => content.split("\n")[line - 1] ?? "";

/** True when the file contains at least one assertion its framework would recognise. */
export function hasAssertion(file, content) {
  if (PY.test(file)) return PY_ASSERTS.test(content);
  if (GO.test(file)) return GO_ASSERTS.test(content);
  return JS_ASSERTS.test(content);
}

function testCount(file, content) {
  if (PY.test(file)) return [...content.matchAll(PY_TEST_DEF)].length;
  if (GO.test(file)) return [...content.matchAll(GO_TEST_FUNC)].length;
  return [...content.matchAll(JS_TEST_CALL)].length;
}

function firstTestIndex(file, content) {
  const re = PY.test(file) ? PY_TEST_DEF : GO.test(file) ? GO_TEST_FUNC : JS_TEST_CALL;
  re.lastIndex = 0;
  const m = re.exec(content);
  // matchAll starts from a global regex's lastIndex, so leave it at 0 for the next file.
  re.lastIndex = 0;
  return m ? m.index : 0;
}

/** Python test functions whose body is only `pass`, `...` or a docstring. */
function emptyPythonTests(content) {
  const lines = content.split("\n");
  const out = [];
  for (const m of content.matchAll(PY_TEST_DEF)) {
    const start = lineAt(content, m.index);
    const indent = m[1].length;
    // Skip the rest of a multi-line signature, up to the line ending in ':'.
    let i = start - 1;
    while (i < lines.length && !/:\s*(?:#.*)?$/.test(lines[i])) i++;
    const body = [];
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      if (l.length - l.trimStart().length <= indent) break;
      body.push(l.trim());
    }
    const code = body.join("\n").replace(/^[rbuf]*("""|''')[\s\S]*?\1/i, "").replace(/^[rbuf]*("|')[^\n]*?\1$/im, "").trim();
    if (body.length > 0 && /^(?:pass|\.\.\.)?$/.test(code.replace(/\s+/g, ""))) out.push({ line: start, text: `def ${m[2]}: empty test body` });
  }
  return out;
}

function collect(content, rules) {
  const out = [];
  for (const { re, why } of rules) {
    re.lastIndex = 0;
    for (const m of content.matchAll(re)) {
      out.push({ line: lineAt(content, m.index + (m[0].length - m[0].trimStart().length)), text: `${why}: ${m[0].trim().replace(/\s+/g, " ").slice(0, 100)}` });
    }
  }
  return out;
}

/**
 * Index just past the brace that closes the one at `open`, skipping strings,
 * template literals and comments; -1 when it never closes (then nothing is judged).
 */
function closingBrace(content, open) {
  let depth = 0;
  for (let i = open; i < content.length; i++) {
    const ch = content[i];
    if (ch === "/" && content[i + 1] === "/") i = content.indexOf("\n", i) < 0 ? content.length : content.indexOf("\n", i);
    else if (ch === "/" && content[i + 1] === "*") i = content.indexOf("*/", i + 2) < 0 ? content.length : content.indexOf("*/", i + 2) + 1;
    else if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < content.length && content[i] !== ch; i++) if (content[i] === "\\") i++;
    } else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

const E2E = /(?:^|\/)(?:cypress|e2e|playwright|integration)\/|\.e2e[-.]/;
// Names a test helper or assertion library usually has; a call to one may fail the test.
const ASSERTING_NAME = /\b\w*(?:assert|expect|check|verify|ensure|should|must|validate|fail)\w*\s*\(/i;
// Assertion libraries whose imports are assertions under any local name.
const ASSERT_MODULES = /^(?:(?:node:)?assert(?:\/strict)?|chai|expect|power-assert|uvu\/assert|@jest\/globals|vitest|should|node:test)$/;

// Local modules that hold test support code (`../SortTester`, `./helpers`, `tests.utils`): what they export may assert.
const TEST_SUPPORT = /^(?:\.|tests?\b|conftest\b)[^"']*(?:test|helper|util|fixture|support|spec|assert|expect|check|harness|conftest)|(?:^|[/.])(?:tests?|__tests__|testing)(?:[/.]|$)/i;

/**
 * Names imported from assertion libraries (`import { strictEqual as eq } from "node:assert"`)
 * and from local test-support modules (`import { SortTester } from "../SortTester"`).
 */
function assertImports(content) {
  const names = new Set();
  const add = (list) => list.split(",").forEach((part) => {
    const m = /([\w$]+)\s*$/.exec(part.trim().replace(/^type\s+/, ""));
    if (m) names.add(m[1]);
  });
  for (const m of content.matchAll(/\bimport\s+([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
    if (!ASSERT_MODULES.test(m[2]) && !TEST_SUPPORT.test(m[2])) continue;
    const braces = /\{([^}]*)\}/.exec(m[1]);
    if (braces) add(braces[1].replace(/\s+as\s+/g, " "));
    const plain = m[1].replace(/\{[^}]*\}/, "").replace(/\*\s+as\s+/, "");
    add(plain);
  }
  for (const m of content.matchAll(/\b(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g)) {
    if (ASSERT_MODULES.test(m[2]) || TEST_SUPPORT.test(m[2])) add(m[1].replace(/[{}]/g, "").replace(/:\s*/g, " "));
  }
  // Python: `from tests.helpers import check_order`, `from .conftest import *` can't be followed, so names only.
  for (const m of content.matchAll(/^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+\(?([^)\n]+)/gm)) {
    if (TEST_SUPPORT.test(m[1])) add(m[2].replace(/\s+as\s+/g, " "));
  }
  return names;
}

/** Functions the test file defines itself: calling one may assert inside it. */
function localFunctions(file, content) {
  const re = PY.test(file)
    ? /^[ \t]*(?:async\s+)?def\s+(\w+)/gm
    : GO.test(file)
      ? /^func\s+(?:\([^)]*\)\s*)?(\w+)/gm
      : /\bfunction\s*\*?\s*([\w$]+)|\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/g;
  const names = new Set();
  for (const m of content.matchAll(re)) names.add(m[1] ?? m[2]);
  return names;
}

// `self.helper(` and `this.helper(` count, so a dot before the name is allowed; so does a call through it (`Tester.run(`).
const callsAny = (body, names) => [...names].some((n) => new RegExp(`(?<![\\w$])${n.replace(/\$/g, "\\$")}\\s*(?:\\(|\\.\\s*[\\w$]+\\s*\\()`).test(body));
const usesParam = (body, params) => params.some((p) => new RegExp(`(?<![\\w$.])${p.replace(/\$/g, "\\$")}(?![\\w$])`).test(body));

/** True when a test body could fail: an assertion, a throw, a helper, or a test handle passed on. */
function bodyMayFail(file, body, params, helpers) {
  if (PY.test(file) ? PY_ASSERTS.test(body) || /\braise\b/.test(body) : GO.test(file) ? GO_ASSERTS.test(body) : JS_ASSERTS.test(body) || /\bthrow\b/.test(body)) return true;
  // Awaited work (an API call, a page action) rejects when it fails, and browser actions wait for their element.
  if (/\bawait\b/.test(body) || /\b(?:page|locator|request|cy)\s*\.\s*\w+\s*\(/.test(body)) return true;
  return ASSERTING_NAME.test(body) || callsAny(body, helpers) || usesParam(body, params);
}

/** Each test's parameters and body. Tests whose body can't be found reliably are left out. */
function testBodies(file, content) {
  const tests = [];
  if (PY.test(file)) {
    const lines = content.split("\n");
    let outerEnd = 0;
    for (const m of content.matchAll(PY_TEST_DEF)) {
      const start = lineAt(content, m.index);
      // A `def test…` nested inside a test (a method of a local class) is not itself a test.
      if (start <= outerEnd) continue;
      const sig = /\(([^)]*)\)/.exec(content.slice(m.index, m.index + 2000));
      const params = (sig?.[1] ?? "").split(",").map((p) => p.trim().split(/[:=\s]/)[0].replace(/^\*+/, "")).filter((p) => p && p !== "self" && p !== "cls");
      let i = start - 1;
      while (i < lines.length && !/:\s*(?:#.*)?$/.test(lines[i])) i++;
      const body = [];
      for (i++; i < lines.length; i++) {
        const l = lines[i];
        if (!l.trim() || /^\s*#/.test(l)) continue;
        if (l.length - l.trimStart().length <= m[1].length) break;
        body.push(l);
        outerEnd = i + 1;
      }
      tests.push({ line: start, name: m[2], params, body: body.join("\n") });
    }
    return tests;
  }
  const re = GO.test(file) ? /^func\s+(Test\w*)\s*\(\s*(\w+)\s+\*testing\.T\s*\)\s*\{/gm : /^[ \t]*(?:it|test)(?:\.(?:concurrent|serial))?\s*\(/gm;
  for (const m of content.matchAll(re)) {
    let open;
    let params = [];
    if (GO.test(file)) {
      open = m.index + m[0].length - 1;
      params = [m[2]];
    } else {
      // The callback is the first arrow or function after the test name: `(a, b) => {`, `async t => {`,
      // `function (done) {`. An expression body (`() => expect(x)…`) or anything else is not judged.
      const head = content.slice(m.index + m[0].length, m.index + m[0].length + 400);
      const first = /=>|\bfunction\b/.exec(head);
      const fn = /(?:^|[,\s(])(?:async\s*)?(?:\(([^()]*)\)|([\w$]+))\s*=>\s*\{|(?:^|[,\s(])(?:async\s+)?function\s*[\w$]*\s*\(([^()]*)\)\s*\{/.exec(head);
      // The block must belong to that first arrow or function, not to a callback nested inside it.
      if (!first || !fn || fn.index + fn[0].search(/=>|\bfunction\b/) !== first.index) continue;
      open = m.index + m[0].length + fn.index + fn[0].length - 1;
      params = (fn[1] ?? fn[2] ?? fn[3] ?? "").replace(/[{}[\]]/g, " ").split(/[\s,]+/).map((p) => p.split(/[:=]/)[0]).filter(Boolean);
    }
    const close = closingBrace(content, open);
    if (close < 0) continue;
    const line = lineAt(content, m.index + (m[0].length - m[0].trimStart().length));
    tests.push({ line, name: GO.test(file) ? m[1] : "", params, body: content.slice(open + 1, close - 1) });
  }
  return tests;
}

/**
 * Tests with no assertion in a file that has assertions elsewhere: one
 * asserting test used to hide its siblings. A warning, because a helper
 * imported from another file can assert out of sight; calls to helpers named
 * like assertions, to functions defined in the file, and uses of the test's
 * own parameters (t, done, fixtures) all count as a way to fail.
 */
function testsWithoutAssertion(file, content) {
  // End-to-end suites drive page objects whose methods assert out of sight.
  if (E2E.test(file)) return [];
  const helpers = new Set([...localFunctions(file, content), ...assertImports(content)]);
  const out = [];
  for (const t of testBodies(file, content)) {
    if (!t.body.trim() || /justified:/.test(lineText(content, t.line))) continue; // an empty body is reported as such
    if (bodyMayFail(file, t.body, t.params, helpers)) continue;
    out.push({ line: t.line, severity: "warn", text: `${t.name ? `${t.name}: ` : ""}this test has no assertion (other tests in the file do), so it passes unless the code throws` });
  }
  return out;
}

/** R-019: tests that cannot fail, and committed `.only`. */
export function fakeTests(file, content) {
  if (!isRealTestFile(file)) return [];
  const out = PY.test(file)
    ? [...collect(content, PY_RULES), ...emptyPythonTests(content)]
    : GO.test(file)
      ? collect(content, GO_RULES)
      : JS.test(file)
        ? collect(content, JS_RULES)
        : [];
  const n = testCount(file, content);
  if (n > 0 && !hasAssertion(file, content)) {
    const line = lineAt(content, firstTestIndex(file, content));
    if (!/justified:/.test(lineText(content, line))) out.push({ line, text: `${n} test${n === 1 ? "" : "s"} and no assertion anywhere in the file` });
  } else if (n > 1) {
    out.push(...testsWithoutAssertion(file, content));
  }
  return dedupe(out);
}

/** R-020: tests skipped unconditionally and committed. Conditional skips (skipIf, skipif) are fine. */
export function skippedTests(file, content) {
  if (!isRealTestFile(file)) return [];
  const re = PY.test(file) ? PY_SKIPS : GO.test(file) ? GO_SKIPS : JS.test(file) ? JS_SKIPS : null;
  if (!re) return [];
  return collect(content, [{ re, why: "skipped" }]).filter((h) => !/justified:/.test(lineText(content, h.line)));
}

function dedupe(hits) {
  const seen = new Set();
  return hits
    .sort((a, b) => a.line - b.line)
    .filter((h) => {
      if (seen.has(h.line)) return false;
      seen.add(h.line);
      return true;
    });
}
