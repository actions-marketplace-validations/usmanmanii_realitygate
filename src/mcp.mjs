// Read-only MCP server over stdio, so any MCP client can ask for the Reality
// Score, the gate result, the Proof Ledger or a skill scan. Dual-era per the
// 2026-07-28 spec: modern requests carry their protocol version in `_meta`;
// legacy clients open with `initialize`. No tool runs project code or writes
// to the project. Messages are newline-delimited JSON-RPC 2.0 on stdout;
// nothing else is ever written there.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { runAudit } from "./audit.mjs";
import { runCheck } from "./check.mjs";
import { KIT_ROOT } from "./init.mjs";
import { proofMarkdown, runProof } from "./proof.mjs";
import { auditMarkdown } from "./report.mjs";
import { FILE_RULES, LINE_RULES } from "./rules.mjs";
import { executedChecks } from "./run.mjs";
import { scanSkills } from "./skill-scan.mjs";

export const MODERN_VERSIONS = ["2026-07-28"];
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const META = "io.modelcontextprotocol/";
const VERSION = JSON.parse(readFileSync(join(KIT_ROOT, "package.json"), "utf8")).version;
const SERVER_INFO = { name: "realitygate", title: "RealityGate", version: VERSION };
const CAPABILITIES = { tools: {} };
const INSTRUCTIONS =
  "Read-only checks of a local repository. `audit` gives the Reality Score (static analysis) plus the rule self-test; it never runs the project's own commands. " +
  "`check` is the Reality Gate. `proof` reads the Proof Ledger. `scan_skills` red-flags a skill or plugin folder before install. Paths are resolved from the server's working directory.";

const PATH_ARG = { path: { type: "string", description: "Directory to inspect, relative to the server's working directory. Default: \".\"" } };
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS = [
  {
    name: "audit",
    title: "Reality Score",
    description: "Reality Score (0-100) from static analysis, with findings, a fix plan, and which checks were executed (the rule self-test) versus not run (tests, clean boot). Never runs project code.",
    inputSchema: { type: "object", properties: PATH_ARG, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "check",
    title: "Reality Gate",
    description: "Run the Reality Gate rules over the repository: errors fail the gate, warnings don't. Reports files scanned per include target.",
    inputSchema: { type: "object", properties: PATH_ARG, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "proof",
    title: "Proof Ledger",
    description: "Which DONE tasks carry recorded evidence in their journals (failing tests first, green gate, approved review, real execution, existing commit).",
    inputSchema: { type: "object", properties: PATH_ARG, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "scan_skills",
    title: "Skill and plugin red-flag scan",
    description: "Red-flag scan of a skill or plugin folder before installing it: remote code execution, obfuscation, credential access, data-leak endpoints, prompt injection, hooks, MCP servers. Reads files only.",
    inputSchema: { type: "object", properties: PATH_ARG, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "list_rules",
    title: "Built-in rules",
    description: "The built-in Reality Gate rules: id, what each catches, and whether it fails the gate or only warns.",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: READ_ONLY,
  },
];

class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

function dir(args, cwd) {
  if (args.path !== undefined && typeof args.path !== "string") throw new ToolError("`path` must be a string");
  const abs = resolve(cwd, args.path ?? ".");
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new ToolError(`not a directory: ${args.path ?? "."}`);
  return abs;
}

class ToolError extends Error {}

async function callTool(name, args, cwd) {
  switch (name) {
    case "audit": {
      const root = dir(args, cwd);
      const result = runAudit(root);
      result.checks = await executedChecks(root);
      return { text: auditMarkdown(result), data: result };
    }
    case "check": {
      const r = runCheck(dir(args, cwd));
      const lines = [r.ok ? `PASS: ${r.filesScanned} files, ${r.warnings.length} warning(s)` : `FAIL: ${r.errors.length + r.scanErrors.length} violation(s) in ${r.filesScanned} files`];
      for (const e of r.scanErrors) lines.push(`SCAN ${e}`);
      for (const f of [...r.errors, ...r.warnings]) lines.push(`${f.severity === "error" ? "error" : "warn "} ${f.file}:${f.line} ${f.rule} ${f.label}: ${f.text}`);
      return { text: lines.join("\n"), data: r };
    }
    case "proof": {
      const r = runProof(dir(args, cwd));
      return { text: proofMarkdown(r), data: r };
    }
    case "scan_skills": {
      const r = scanSkills(dir(args, cwd));
      const lines = [`${r.high} HIGH, ${r.medium} MEDIUM red flag(s) in ${r.filesScanned} files.`];
      for (const f of r.findings) lines.push(`${f.severity} ${f.file}:${f.line} ${f.id} ${f.label}`);
      lines.push("A clean scan is not a guarantee: read the skills and check the publisher.");
      return { text: lines.join("\n"), data: r };
    }
    case "list_rules": {
      const rules = [...LINE_RULES, ...FILE_RULES].map((r) => ({ id: r.id, label: r.label, severity: r.severity ?? "error" }));
      return { text: rules.map((r) => `${r.id} (${r.severity}) ${r.label}`).join("\n"), data: { rules } };
    }
    default:
      throw new RpcError(-32602, `Unknown tool: ${name}`);
  }
}

/**
 * Handles one JSON-RPC message and returns the response object, or null for
 * notifications. `state.legacy` is the version agreed by `initialize`, if any.
 */
export async function handleMessage(msg, state, { cwd = process.cwd() } = {}) {
  const isRequest = msg && typeof msg === "object" && "id" in msg && msg.id !== null;
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "Invalid Request" } };
  }
  if (!isRequest) return null; // notifications/initialized, notifications/cancelled, …

  const params = msg.params ?? {};
  const meta = params._meta ?? {};
  const requested = meta[`${META}protocolVersion`];
  const modern = typeof requested === "string";
  const reply = (result) => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: modern ? { resultType: "complete", ...result, _meta: { ...result._meta, [`${META}serverInfo`]: SERVER_INFO } } : result,
  });

  try {
    if (msg.method === "initialize") {
      const version = LEGACY_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : LEGACY_VERSIONS[0];
      state.legacy = version;
      return { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: version, capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS } };
    }
    if (modern) {
      if (!MODERN_VERSIONS.includes(requested)) {
        throw new RpcError(-32022, "Unsupported protocol version", { supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], requested });
      }
      if (typeof meta[`${META}clientCapabilities`] !== "object" || meta[`${META}clientCapabilities`] === null) {
        throw new RpcError(-32602, `Missing required _meta field ${META}clientCapabilities`);
      }
    } else if (!state.legacy && msg.method !== "ping") {
      throw new RpcError(-32602, `Missing required _meta field ${META}protocolVersion (or send initialize first)`);
    }

    switch (msg.method) {
      case "server/discover":
        return reply({ supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], capabilities: CAPABILITIES, instructions: INSTRUCTIONS });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: TOOLS });
      case "tools/call": {
        if (typeof params.name !== "string") throw new RpcError(-32602, "tools/call needs a tool `name`");
        if (params.arguments !== undefined && (typeof params.arguments !== "object" || params.arguments === null || Array.isArray(params.arguments))) {
          throw new RpcError(-32602, "tool `arguments` must be an object");
        }
        try {
          const { text, data } = await callTool(params.name, params.arguments ?? {}, cwd);
          return reply({ content: [{ type: "text", text }], structuredContent: data, isError: false });
        } catch (e) {
          if (e instanceof RpcError) throw e;
          return reply({ content: [{ type: "text", text: `realitygate: ${e.message}` }], isError: true });
        }
      }
      default:
        throw new RpcError(-32601, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    if (!(e instanceof RpcError)) throw e;
    return { jsonrpc: "2.0", id: msg.id, error: { code: e.code, message: e.message, ...(e.data ? { data: e.data } : {}) } };
  }
}

/** Serves stdin → stdout until stdin closes. */
export function serveStdio({ input = process.stdin, output = process.stdout } = {}) {
  const state = { legacy: null };
  const rl = createInterface({ input, crlfDelay: Infinity });
  let queue = Promise.resolve();
  rl.on("line", (line) => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
        return;
      }
      let res;
      try {
        res = await handleMessage(msg, state);
      } catch (e) {
        res = { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32603, message: `Internal error: ${e.message}` } };
      }
      if (res) output.write(`${JSON.stringify(res)}\n`);
    });
  });
  return new Promise((resolvePromise) => rl.on("close", () => queue.then(resolvePromise)));
}
