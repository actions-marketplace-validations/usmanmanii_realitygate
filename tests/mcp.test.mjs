import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { handleMessage, LEGACY_VERSIONS, TOOLS } from "../src/mcp.mjs";
import { cli, makeProject } from "./helpers.mjs";

const cleanups = [];
after(() => cleanups.forEach((c) => c()));
const project = (files) => {
  const p = makeProject(files);
  cleanups.push(p.cleanup);
  return p.dir;
};

const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
const modern = (id, method, params = {}) => ({ jsonrpc: "2.0", id, method, params: { ...params, _meta: META } });

describe("MCP server: modern (2026-07-28, per-request _meta)", () => {
  test("server/discover lists versions, the tools capability and server identity", async () => {
    const r = await handleMessage(modern(1, "server/discover"), {});
    assert.equal(r.result.resultType, "complete");
    assert.ok(r.result.supportedVersions.includes("2026-07-28"));
    assert.deepEqual(r.result.capabilities, { tools: {} });
    assert.equal(r.result._meta["io.modelcontextprotocol/serverInfo"].name, "realitygate");
  });

  test("tools/list: every tool is read-only and takes an object", async () => {
    const r = await handleMessage(modern(2, "tools/list"), {});
    assert.deepEqual(r.result.tools.map((t) => t.name), ["audit", "check", "proof", "scan_skills", "list_rules"]);
    for (const t of TOOLS) {
      assert.equal(t.annotations.readOnlyHint, true, t.name);
      assert.equal(t.inputSchema.type, "object", t.name);
    }
  });

  test("tools/call audit returns the score, static vs executed, as text and structured content", async () => {
    const dir = project({ "package.json": { name: "x" }, "src/a.ts": "export const a = 1; // TODO wire\n" });
    const r = await handleMessage(modern(3, "tools/call", { name: "audit", arguments: { path: "." } }), {}, { cwd: dir });
    assert.equal(r.result.isError, false);
    assert.equal(typeof r.result.structuredContent.score, "number");
    assert.match(r.result.content[0].text, /## Inferred \(static\)/);
    assert.equal(r.result.structuredContent.checks.find((c) => c.id === "tests").status, "NOT RUN");
  });

  test("tools/call check reports a failing gate", async () => {
    const dir = project({ "src/a.ts": "export const a = 1; // TODO wire\n" });
    const r = await handleMessage(modern(4, "tools/call", { name: "check", arguments: {} }), {}, { cwd: dir });
    assert.match(r.result.content[0].text, /^FAIL: 1 violation/);
    assert.equal(r.result.structuredContent.ok, false);
  });

  test("a tool that cannot run is a tool error the model can read, not a protocol error", async () => {
    const r = await handleMessage(modern(5, "tools/call", { name: "proof", arguments: { path: "." } }), {}, { cwd: project({ "a.txt": "x" }) });
    assert.equal(r.result.isError, true);
    const bad = await handleMessage(modern(6, "tools/call", { name: "check", arguments: { path: "does/not/exist" } }), {});
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /not a directory/);
  });

  test("unknown tool, unknown method, unsupported version and missing _meta are JSON-RPC errors", async () => {
    assert.equal((await handleMessage(modern(7, "tools/call", { name: "rm_rf" }), {})).error.code, -32602);
    assert.equal((await handleMessage(modern(8, "resources/list"), {})).error.code, -32601);
    const old = await handleMessage({ jsonrpc: "2.0", id: 9, method: "tools/list", params: { _meta: { ...META, "io.modelcontextprotocol/protocolVersion": "1900-01-01" } } }, {});
    assert.equal(old.error.code, -32022);
    assert.deepEqual(old.error.data.requested, "1900-01-01");
    const noCaps = await handleMessage({ jsonrpc: "2.0", id: 10, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }, {});
    assert.equal(noCaps.error.code, -32602);
    const noMeta = await handleMessage({ jsonrpc: "2.0", id: 11, method: "tools/list" }, {});
    assert.equal(noMeta.error.code, -32602);
  });
});

describe("MCP server: legacy (initialize handshake)", () => {
  test("initialize echoes a supported version, falls back to the latest otherwise, then serves without _meta", async () => {
    const state = {};
    const init = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } } }, state);
    assert.equal(init.result.protocolVersion, "2025-06-18");
    assert.equal(init.result.serverInfo.name, "realitygate");
    assert.equal(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, state), null);
    const list = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, state);
    assert.equal(list.result.resultType, undefined);
    assert.equal(list.result.tools.length, TOOLS.length);
    const future = await handleMessage({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2099-01-01", capabilities: {} } }, {});
    assert.equal(future.result.protocolVersion, LEGACY_VERSIONS[0]);
  });
});

describe("realitygate mcp over stdio", () => {
  test("every stdout line is a JSON-RPC message, notifications get no reply, and it exits when stdin closes", () => {
    const input = [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      "not json",
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_rules", arguments: {} } }),
    ].join("\n");
    const r = cli(["mcp"], { input });
    assert.equal(r.code, 0);
    const lines = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.id), [1, null, 2]);
    assert.equal(lines[1].error.code, -32700);
    assert.ok(lines[2].result.structuredContent.rules.some((rule) => rule.id === "R-018" && rule.severity === "warn"));
  });
});
