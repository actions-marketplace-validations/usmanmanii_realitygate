import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE = "realitygate.config.json";

export const DEFAULT_EXCLUDE = [
  "**/*.d.ts",
  "**/*.config.{js,cjs,mjs,ts,cts,mts}",
  "**/scripts/seed*",
  "**/seed/**",
  "**/seeds/**",
  "**/seed.{js,cjs,mjs,ts,cts,mts}",
  "**/migrations/**",
  "**/generated/**",
  "**/__generated__/**",
  "**/*.pb.go",
  "**/*_pb2.py",
  "**/*_pb2_grpc.py",
];

export const DEFAULT_CONFIG = {
  include: [],
  exclude: [],
  disable: [],
  mayBeEmpty: {},
  rules: [],
  fileRules: [],
  hooks: { protectedPaths: [], appliedMigrationsManifest: null },
  run: { test: null, install: null, start: null, ready: null, probe: null, timeout: 60 },
};

export class ConfigError extends Error {}

/**
 * Loads and validates realitygate.config.json. Every field is optional.
 * `exclude` entries may be a glob string or `{ "glob": "...", "reason": "..." }`.
 */
export function loadConfig(root, explicitPath) {
  const path = explicitPath ? join(root, explicitPath) : join(root, CONFIG_FILE);
  if (!existsSync(path)) {
    if (explicitPath) throw new ConfigError(`config file not found: ${explicitPath}`);
    return { ...structuredClone(DEFAULT_CONFIG), source: null, excludeReasons: {}, disableReasons: {} };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ConfigError(`${CONFIG_FILE} is not valid JSON: ${err.message}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(`${CONFIG_FILE} must contain a JSON object`);
  }

  const cfg = { ...structuredClone(DEFAULT_CONFIG), source: path, excludeReasons: {}, disableReasons: {} };
  cfg.include = stringArray(raw.include ?? [], "include");
  // Reasons are kept so every report can show what was left out and why.
  cfg.exclude = (raw.exclude ?? []).map((e, i) => {
    if (typeof e === "string") return e;
    if (e && typeof e.glob === "string") {
      if (typeof e.reason === "string" && e.reason.trim()) cfg.excludeReasons[e.glob] = e.reason.trim();
      return e.glob;
    }
    throw new ConfigError(`exclude[${i}] must be a glob string or { glob, reason }`);
  });
  if (!Array.isArray(raw.disable ?? [])) throw new ConfigError("disable must be an array of rule ids or { id, reason }");
  cfg.disable = (raw.disable ?? []).map((d, i) => {
    if (typeof d === "string") return d;
    if (d && typeof d.id === "string") {
      if (typeof d.reason === "string" && d.reason.trim()) cfg.disableReasons[d.id] = d.reason.trim();
      return d.id;
    }
    throw new ConfigError(`disable[${i}] must be a rule id or { id, reason }`);
  });

  const mayBeEmpty = raw.mayBeEmpty ?? {};
  if (typeof mayBeEmpty !== "object" || Array.isArray(mayBeEmpty)) {
    throw new ConfigError("mayBeEmpty must be an object of { glob: reason }");
  }
  for (const [glob, reason] of Object.entries(mayBeEmpty)) {
    if (typeof reason !== "string" || !reason.trim()) {
      throw new ConfigError(`mayBeEmpty["${glob}"] needs a written reason`);
    }
  }
  cfg.mayBeEmpty = mayBeEmpty;

  cfg.rules = (raw.rules ?? []).map((r, i) => {
    const where = `rules[${i}]`;
    requireString(r?.id, `${where}.id`);
    requireString(r?.label, `${where}.label`);
    requireString(r?.pattern, `${where}.pattern`);
    return {
      id: r.id,
      label: r.label,
      re: compile(r.pattern, r.flags, `${where}.pattern`),
      paths: r.paths ? stringArray(r.paths, `${where}.paths`) : null,
      severity: r.severity === "warn" ? "warn" : "error",
      canary: typeof r.canary === "string" ? r.canary : null,
      custom: true,
    };
  });

  cfg.fileRules = (raw.fileRules ?? []).map((r, i) => {
    const where = `fileRules[${i}]`;
    requireString(r?.id, `${where}.id`);
    requireString(r?.label, `${where}.label`);
    requireString(r?.trigger, `${where}.trigger`);
    requireString(r?.mustContain, `${where}.mustContain`);
    return {
      id: r.id,
      label: r.label,
      trigger: compile(r.trigger, r.flags, `${where}.trigger`),
      mustContain: compile(r.mustContain, r.flags, `${where}.mustContain`),
      paths: r.paths ? stringArray(r.paths, `${where}.paths`) : null,
      canary: typeof r.canary === "string" ? r.canary : null,
      custom: true,
    };
  });

  const hooks = raw.hooks ?? {};
  cfg.hooks = {
    protectedPaths: stringArray(hooks.protectedPaths ?? [], "hooks.protectedPaths"),
    appliedMigrationsManifest:
      typeof hooks.appliedMigrationsManifest === "string" ? hooks.appliedMigrationsManifest : null,
  };

  const run = raw.run ?? {};
  if (typeof run !== "object" || Array.isArray(run)) throw new ConfigError("run must be an object");
  for (const key of ["test", "install", "start", "ready", "probe"]) {
    if (run[key] !== undefined && run[key] !== null && typeof run[key] !== "string") throw new ConfigError(`run.${key} must be a string`);
    cfg.run[key] = run[key] ?? null;
  }
  if (cfg.run.ready !== null) compile(cfg.run.ready, "", "run.ready");
  if (run.timeout !== undefined) {
    if (!Number.isFinite(run.timeout) || run.timeout <= 0) throw new ConfigError("run.timeout must be a positive number of seconds");
    cfg.run.timeout = run.timeout;
  }
  return cfg;
}

function stringArray(value, name) {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new ConfigError(`${name} must be an array of strings`);
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string" || !value) throw new ConfigError(`${name} is required`);
}

function compile(pattern, flags, name) {
  try {
    return new RegExp(pattern, (flags ?? "").replace(/g/g, ""));
  } catch (err) {
    throw new ConfigError(`${name} is not a valid regular expression: ${err.message}`);
  }
}
