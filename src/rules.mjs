// Built-in Reality Gate rules. Each rule is a deterministic tripwire; the
// verifier agent does the semantic review. This file is excluded from the
// kit's own scan (realitygate.config.json) because its patterns are, by
// definition, the strings it forbids.

import { JS_TS_EXT, TS_EXT } from "./files.mjs";
import { undocumentedReads } from "./env.mjs";
import { extractImports } from "./imports.mjs";
import { extractGoImports, extractPythonImports } from "./langs.mjs";
import { MANIFEST } from "./lockfile.mjs";
import { fakeTests, skippedTests } from "./testquality.mjs";
import { unwiredExports } from "./unwired.mjs";

const CODE_EXT = /\.(?:[cm]?[jt]sx?|py|go)$/;
const PY_EXT = /\.py$/;
const JS_TS_PY_EXT = /\.(?:[cm]?[jt]sx?|py)$/;
const SERVICE_FILE = /(?:^|\/)(?:services?\/|(?:service|[^/]+[.-]service)\.[cm]?[jt]sx?$)/;

export const LINE_RULES = [
  {
    id: "R-001",
    skipInRegexLiteral: true,
    label: "placeholder marker (TODO/FIXME/XXX/HACK) in app code",
    re: /(?:\/\/|\/\*|^\s*\*|#|<!--).*\b(?:TODO|FIXME|XXX|HACK)\b/,
    exts: CODE_EXT,
  },
  {
    id: "R-002",
    skipInRegexLiteral: true,
    label: "stub implementation",
    re: /\bnot\s+(?:yet\s+)?implemented\b|\bunimplemented\b|\bstub(?:bed)?\s+(?:out|implementation)\b/i,
    exts: CODE_EXT,
  },
  {
    id: "R-003",
    skipInRegexLiteral: true,
    label: "placeholder copy (lorem ipsum / coming soon)",
    re: /lorem ipsum|coming soon/i,
    exts: CODE_EXT,
  },
  {
    id: "R-004",
    skipInRegexLiteral: true,
    label: "simulated implementation (\"for now\", \"in a real app\", …)",
    re: /\bfor now\b|in a real (?:app|application|implementation|world|system|project)\b|in production,? (?:you|we) (?:would|should)|(?:replace|swap) (?:this|me) with (?:a |the )?(?:real|actual)\b|placeholder (?:implementation|logic|value|data)\b/i,
    exts: CODE_EXT,
  },
  {
    id: "R-005",
    skipInRegexLiteral: true,
    label: "hardcoded sample/fake data outside tests",
    re: /\b(?:john|jane)\s+doe\b|\b(?:test|foo|user|admin|example)@example\.(?:com|org|net)\b|\b(?:dummy|fake|sample|mock)[ _-]?(?:data|users?|response|items?|products?|orders?|records?)\b/i,
    exts: CODE_EXT,
  },
  {
    id: "R-006",
    label: "unjustified @ts-ignore / @ts-nocheck / @ts-expect-error / # type: ignore",
    re: /@ts-(?:ignore|nocheck|expect-error)\b|#\s*type:\s*ignore\b|#\s*pyright:\s*ignore\b/,
    exts: JS_TS_PY_EXT,
    justifiable: true,
  },
  {
    id: "R-007",
    label: "unjustified eslint-disable / # noqa / # pylint: disable",
    re: /eslint-disable|#\s*noqa\b|#\s*pylint:\s*disable\b/,
    exts: JS_TS_PY_EXT,
    justifiable: true,
  },
  {
    id: "R-008",
    label: "explicit `any` without justification",
    re: /:\s*any\b(?![\w-])|\bas\s+any\b|<any>|\bany\[\]/,
    exts: TS_EXT,
    justifiable: true,
  },
  {
    id: "R-009",
    label: "console.log in app code (use a logger)",
    skipPaths: /(?:^|\/)(?:scripts|bin|cli|tools)\/|(?:^|\/)(?:seed|setup|migrate|bootstrap)[\w.-]*\.[cm]?[jt]s$/,
    re: /\bconsole\.log\s*\(/,
    exts: JS_TS_EXT,
  },
  {
    id: "R-010",
    label: "commented-out code",
    re: /^\s*\/\/\s*(?:(?:const|let|var|return|import|export|await|function)\b|(?:if|for|while)\s*\().*[;{})]\s*$/,
    exts: JS_TS_EXT,
    severity: "warn",
  },
  {
    id: "R-011",
    label: "hardcoded secret / credential",
    re: /\bsk_live_[0-9a-zA-Z]{10,}|\brk_live_[0-9a-zA-Z]{10,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|\bghp_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{50,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{35}\b|\bsk-ant-[A-Za-z0-9_-]{20,}|\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/,
    exts: /\.(?:[cm]?[jt]sx?|py|json|ya?ml|toml)$/,
  },
  {
    id: "R-012",
    label: "secret exposed to the client via a public env prefix",
    re: /\b(?:NEXT_PUBLIC|EXPO_PUBLIC|VITE|REACT_APP|NUXT_PUBLIC|PUBLIC)_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE)[A-Z0-9_]*\b/,
    exts: /\.(?:[cm]?[jt]sx?|json|ya?ml|toml)$/,
  },
];

const ROUTE_FILE = /(?:^|\/)app\/(?:.*\/)?route\.[cm]?[jt]s$|(?:^|\/)pages\/api\/.+\.[cm]?[jt]s$/;
const SERVER_ROUTE_CALL = /\b(?:app|router|server|fastify)\.(?:get|post|put|patch|delete|all|route)\s*\(/;
const READS_INPUT = /\b(?:request|req|c\.req|ctx\.request)\.(?:json|formData|text)\s*\(|\breq(?:uest)?\.(?:body|query|params)\b|\bsearchParams\b|\bctx\.request\.body\b|\bc\.req\.(?:param|query)\s*\(/;
const VALIDATES = /from\s+["'](?:zod|yup|valibot|joi|@hapi\/joi|ajv|superstruct|arktype|@sinclair\/typebox|class-validator|@effect\/schema|effect)["']|\bzValidator\b|\bvalidator\s*\(|\bwebhooks\.constructEvent(?:Async)?\s*\(|\bverify(?:Webhook|Signature|Request)\w*\s*\(|\bnew\s+Webhook\s*\(/;
// `Schema.parse(x)` validates; `JSON.parse(x)` and other format parsers only decode, so the receiver decides.
const VALIDATE_CALL = /([\w$]*)\s*\.\s*(?:safeParse|parse|parseAsync|safeParseAsync|validate|validateSync|assert)\s*\(/g;
const DECODERS = new Set(["json", "json5", "qs", "querystring", "url", "path", "date", "cookie", "cookies", "yaml", "toml", "csv", "papa", "marked", "ini", "xml", "semver", "dotenv", "mime", "number", "bigint"]);

const PY_ROUTE = /@\w+\.(?:route|get|post|put|patch|delete|api_route)\s*\(/;
const PY_READS_INPUT = /\brequest\.(?:json|form|args|values|data|files|POST|GET|body)\b|\brequest\.get_json\s*\(|\bawait\s+request\.(?:json|form|body)\s*\(/;
const PY_VALIDATES = /^\s*(?:from|import)\s+(?:pydantic|marshmallow|wtforms|flask_wtf|cerberus|voluptuous|jsonschema|msgspec|cattrs|webargs|rest_framework)\b|\.(?:model_validate|model_validate_json|parse_obj)\s*\(|\.is_valid\s*\(|\bforms\.\w*Form\b/m;
// marshmallow's `schema.load(data)` validates; `json.load(f)` and the like only decode.
const PY_VALIDATE_CALL = /([\w.]*)\s*\.\s*(?:validate|load)\s*\(/g;
const PY_DECODERS = new Set(["json", "pickle", "yaml", "toml", "tomllib", "tomli", "marshal", "csv", "orjson", "ujson", "simplejson", "msgpack", "plistlib", "shelve", "np", "numpy", "torch", "joblib", "dotenv", "load_dotenv"]);

// Package names whose default or namespace import is a decoder, beyond the ones spelled like DECODERS.
const DECODER_MODULES = new Map([["js-yaml", "yaml"], ["papaparse", "papa"], ["@iarna/toml", "toml"], ["smol-toml", "toml"], ["node:querystring", "querystring"], ["node:url", "url"], ["node:path", "path"]]);

/**
 * Names that hold a decoder under another name: `const p = JSON`,
 * `import * as y from "yaml"`, `const q = require("qs")`, `import json as j`,
 * `j = json`. Followed in order, so an alias of an alias counts too.
 */
function decoderAliases(content, decoders, python) {
  const aliases = new Set();
  const isDecoder = (name) => decoders.has(name.toLowerCase()) || aliases.has(name.toLowerCase());
  const moduleDecoder = (spec) => {
    const s = spec.toLowerCase();
    const name = DECODER_MODULES.get(s) ?? s.replace(/^node:/, "");
    return decoders.has(name);
  };
  const patterns = python
    ? [
        [/^[ \t]*import[ \t]+([\w.]+)[ \t]+as[ \t]+(\w+)/gm, (m) => decoders.has(m[1].split(".").pop().toLowerCase()), 2],
        [/^[ \t]*(\w+)[ \t]*=[ \t]*([\w.]+)[ \t]*(?:#.*)?$/gm, (m) => isDecoder(m[2].split(".").pop()), 1],
      ]
    : [
        [/\b(?:const|let|var)\s+([\w$]+)\s*=\s*([\w$.]+)\s*(?:;|$)/gm, (m) => isDecoder(m[2].split(".").pop()), 1],
        [/\bimport\s+(?:\*\s+as\s+)?([\w$]+)\s+from\s+["']([^"']+)["']/g, (m) => moduleDecoder(m[2]), 1],
        [/\b(?:const|let|var)\s+([\w$]+)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g, (m) => moduleDecoder(m[2]), 1],
      ];
  // Matches in source order, so `a = JSON` then `b = a` resolves both.
  const all = patterns.flatMap(([re, test, group]) => [...content.matchAll(re)].map((m) => ({ m, test, group })));
  all.sort((a, b) => a.m.index - b.m.index);
  for (const { m, test, group } of all) if (test(m)) aliases.add(m[group].toLowerCase());
  return aliases;
}

/** True when some `.parse(`/`.validate(`-style call is made on something other than a plain decoder. */
function callsValidator(content, re, decoders, python = false) {
  const aliases = decoderAliases(content, decoders, python);
  for (const [, receiver] of content.matchAll(re)) {
    const name = receiver.split(".").pop().toLowerCase();
    if (!decoders.has(name) && !aliases.has(name)) return true;
  }
  return false;
}

/** A whole service implementation that only returns null is a likely stub. */
function nullOnlyServiceMethods(file, content) {
  if (!SERVICE_FILE.test(file)) return [];
  const code = maskStringsAndComments(content);
  const hits = [];
  const block = /(^|\n)[ \t]*(?:export\s+)?(?:default\s+)?(?:(?:public|private|protected|static|override|async)\s+)*(?:function\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{}\n]+)?\{\s*return\s+null\s*;?\s*\}/g;
  const arrow = /(^|\n)[ \t]*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^{}=\n]+)?=>\s*(?:\{\s*return\s+null\s*;?\s*\}|null\b(?=\s*(?:;|\n|$)))/g;
  for (const re of [block, arrow]) {
    for (const match of code.matchAll(re)) {
      if (re === block && /^(?:if|for|while|switch|catch|with)$/.test(match[2])) continue;
      hits.push({ line: lineOf(content, match.index + match[1].length), text: `${match[2]} always returns null` });
    }
  }
  return hits;
}

/** Preserve offsets and newlines while removing text that only looks like code. */
function maskStringsAndComments(content) {
  const out = [...content];
  let mode = "code";
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    if (mode === "code") {
      if (ch === "/" && next === "/") { mode = "line"; out[i] = out[++i] = " "; }
      else if (ch === "/" && next === "*") { mode = "block"; out[i] = out[++i] = " "; }
      else if (ch === "'" || ch === '"' || ch === "`") { mode = ch; out[i] = " "; }
    } else if (mode === "line") {
      if (ch === "\n") mode = "code";
      else out[i] = " ";
    } else if (mode === "block") {
      if (ch === "*" && next === "/") { out[i] = out[++i] = " "; mode = "code"; }
      else if (ch !== "\n") out[i] = " ";
    } else if (ch === "\\") {
      out[i] = " ";
      if (next !== undefined) { i++; if (next !== "\n") out[i] = " "; }
    } else if (ch === mode) {
      out[i] = " ";
      mode = "code";
    } else if (ch !== "\n") out[i] = " ";
  }
  return out.join("");
}

export const FILE_RULES = [
  {
    id: "R-013",
    label: "swallowed error (empty catch / catch returning nothing)",
    exts: CODE_EXT,
    check(file, content) {
      const patterns = JS_TS_EXT.test(file)
        ? [
            /catch\s*(?:\(\s*[\w$]*\s*(?::\s*\w+\s*)?\))?\s*\{\s*\}/g,
            /\.catch\(\s*(?:\(\s*[\w$]*\s*\)|[\w$]+)\s*=>\s*(?:\{\s*\}|null|undefined|\[\]|\(\s*\{\s*\}\s*\))\s*\)/g,
          ]
        : PY_EXT.test(file)
          ? [/except(?:\s+[\w.]+(?:\s+as\s+\w+)?)?\s*:\s*(?:\r?\n\s*)?pass\b/g]
          : [/if\s+err\s*!=\s*nil\s*\{\s*\}/g, /^\s*_\s*=\s*err\s*$/gm];
      return matchAll(content, patterns);
    },
  },
  {
    id: "R-014",
    label: "import of a package the project doesn't declare (hallucinated or missing dependency)",
    exts: CODE_EXT,
    check(file, content, ctx) {
      const [resolver, imports] = PY_EXT.test(file)
        ? [ctx.python, () => extractPythonImports(content)]
        : file.endsWith(".go")
          ? [ctx.go, () => extractGoImports(content)]
          : [ctx.resolver?.hasAnyPackageJson ? ctx.resolver : null, () => extractImports(content)];
      if (!resolver || resolver.active === false) return [];
      return imports()
        .filter(({ specifier }) => !resolver.isDeclared(file, specifier))
        .map(({ specifier, line }) => ({ line, text: `import "${specifier}"` }));
    },
  },
  {
    id: "R-015",
    label: "route reads request input without schema validation",
    exts: JS_TS_PY_EXT,
    check(file, content) {
      if (PY_EXT.test(file)) {
        const isRoute = PY_ROUTE.test(content) || (/(?:^|\/)views\.py$/.test(file) && /\bdef\s+\w+\(\s*(?:self\s*,\s*)?request\b/.test(content));
        if (!isRoute || !PY_READS_INPUT.test(content) || PY_VALIDATES.test(content) || callsValidator(content, PY_VALIDATE_CALL, PY_DECODERS, true)) return [];
        return [{ line: lineOf(content, content.search(PY_READS_INPUT)), text: "reads input; no pydantic/marshmallow/forms/serializer validation found" }];
      }
      const isRoute = ROUTE_FILE.test(file) || SERVER_ROUTE_CALL.test(content);
      if (!isRoute || !READS_INPUT.test(content) || VALIDATES.test(content) || callsValidator(content, VALIDATE_CALL, DECODERS)) return [];
      return [{ line: lineOf(content, content.search(READS_INPUT)), text: "reads input; no zod/yup/valibot/joi/ajv validation found" }];
    },
  },
  {
    id: "R-016",
    label: "cross-module repo import (modules/<a> importing modules/<b>/repo)",
    exts: JS_TS_EXT,
    check(file, content) {
      const owner = /(?:^|\/)modules\/([\w-]+)\//.exec(file)?.[1];
      return extractImports(content)
        .map(({ specifier, line }) => ({ line, target: /modules\/([\w-]+)\/repo(?:\.[cm]?[jt]s)?$/.exec(specifier)?.[1], specifier }))
        .filter(({ target }) => target && target !== owner)
        .map(({ line, specifier }) => ({ line, text: `import "${specifier}"` }));
    },
  },
  {
    id: "R-017",
    label: "env var read in code but missing from .env.example",
    exts: CODE_EXT,
    check(file, content, ctx) {
      const documented = ctx.env.forFile(file);
      if (!documented) return [];
      return undocumentedReads(file, content, documented).map(({ name, line }) => ({ line, text: `${name} is not listed in ${documented.files.join(", ")}` }));
    },
  },
  {
    id: "R-018",
    label: "unwired code: exported but never imported or called",
    exts: JS_TS_EXT,
    severity: "warn",
    check(file, content, ctx) {
      return unwiredExports(file, content, ctx.usage);
    },
  },
  // The two rules below read test files, which every other rule skips.
  {
    id: "R-019",
    label: "test that can't fail: empty body, always-true assertion, no assertion, or committed .only",
    exts: CODE_EXT,
    tests: true,
    check(file, content) {
      return fakeTests(file, content);
    },
  },
  {
    id: "R-020",
    label: "test skipped unconditionally (.skip, xit, @pytest.mark.skip, t.Skip)",
    exts: CODE_EXT,
    tests: true,
    severity: "warn",
    check(file, content) {
      return skippedTests(file, content);
    },
  },
  // Reads dependency manifests, not source. A warning ("can't verify") when there's no lockfile.
  {
    id: "R-021",
    label: "declared dependency missing from the lockfile (never installed; may not exist)",
    exts: MANIFEST,
    manifests: true,
    check(file, content, ctx) {
      return ctx.locks.check(file, content);
    },
  },
  {
    id: "R-022",
    label: "service method whose entire implementation returns null",
    exts: JS_TS_EXT,
    check: nullOnlyServiceMethods,
  },
];

export const TEST_RULE_IDS = new Set(FILE_RULES.filter((r) => r.tests).map((r) => r.id));
export const MANIFEST_RULE_IDS = new Set(FILE_RULES.filter((r) => r.manifests).map((r) => r.id));

export function lineOf(content, index) {
  if (index < 0) return 1;
  let line = 1;
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

function matchAll(content, patterns) {
  const out = [];
  for (const re of patterns) {
    for (const m of content.matchAll(re)) {
      out.push({ line: lineOf(content, m.index), text: m[0].replace(/\s+/g, " ").slice(0, 120) });
    }
  }
  return out;
}

export const BUILTIN_RULE_IDS = [...LINE_RULES, ...FILE_RULES].map((r) => r.id);
