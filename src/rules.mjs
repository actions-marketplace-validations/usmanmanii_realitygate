// Built-in Reality Gate rules. Each rule is a deterministic tripwire; the
// verifier agent does the semantic review. This file is excluded from the
// kit's own scan (realitygate.config.json) because its patterns are, by
// definition, the strings it forbids.

import { JS_TS_EXT, TS_EXT } from "./files.mjs";
import { extractImports } from "./imports.mjs";

const CODE_EXT = /\.(?:[cm]?[jt]sx?|py)$/;

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
    label: "unjustified @ts-ignore / @ts-nocheck / @ts-expect-error",
    re: /@ts-(?:ignore|nocheck|expect-error)\b/,
    exts: JS_TS_EXT,
    justifiable: true,
  },
  {
    id: "R-007",
    label: "unjustified eslint-disable",
    re: /eslint-disable/,
    exts: JS_TS_EXT,
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
const VALIDATES = /from\s+["'](?:zod|yup|valibot|joi|@hapi\/joi|ajv|superstruct|arktype|@sinclair\/typebox|class-validator|@effect\/schema|effect)["']|\.(?:safeParse|parse|parseAsync|safeParseAsync|validate|validateSync|assert)\s*\(|\bzValidator\b|\bvalidator\s*\(|\bwebhooks\.constructEvent(?:Async)?\s*\(|\bverify(?:Webhook|Signature|Request)\w*\s*\(|\bnew\s+Webhook\s*\(/;

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
        : [/except(?:\s+[\w.]+(?:\s+as\s+\w+)?)?\s*:\s*(?:\r?\n\s*)?pass\b/g];
      return matchAll(content, patterns);
    },
  },
  {
    id: "R-014",
    label: "import of a package not declared in any package.json (hallucinated or missing dependency)",
    exts: JS_TS_EXT,
    check(file, content, ctx) {
      if (!ctx.resolver?.hasAnyPackageJson) return [];
      return extractImports(content)
        .filter(({ specifier }) => !ctx.resolver.isDeclared(file, specifier))
        .map(({ specifier, line }) => ({ line, text: `import "${specifier}"` }));
    },
  },
  {
    id: "R-015",
    label: "route reads request input without schema validation",
    exts: JS_TS_EXT,
    check(file, content) {
      const isRoute = ROUTE_FILE.test(file) || SERVER_ROUTE_CALL.test(content);
      if (!isRoute || !READS_INPUT.test(content) || VALIDATES.test(content)) return [];
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
];

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
