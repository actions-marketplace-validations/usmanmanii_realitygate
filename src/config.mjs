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
];

export const DEFAULT_CONFIG = {
  include: [],
  exclude: [],
  disable: [],
  mayBeEmpty: {},
  rules: [],
  fileRules: [],
  hooks: { protectedPaths: [], appliedMigrationsManifest: null },
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
    return { ...structuredClone(DEFAULT_CONFIG), source: null };
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

  const cfg = { ...structuredClone(DEFAULT_CONFIG), source: path };
  cfg.include = stringArray(raw.include ?? [], "include");
  cfg.exclude = (raw.exclude ?? []).map((e, i) => {
    if (typeof e === "string") return e;
    if (e && typeof e.glob === "string") return e.glob;
    throw new ConfigError(`exclude[${i}] must be a glob string or { glob, reason }`);
  });
  cfg.disable = stringArray(raw.disable ?? [], "disable");

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
