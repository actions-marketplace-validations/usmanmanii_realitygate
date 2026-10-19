// Supply-chain red-flag scanner for agent skills and plugins (ours or anyone's).
// It reads files only: nothing in the scanned package is executed or installed.
// Pattern scanning cannot prove a package is safe (natural-language instructions
// can be malicious in endless phrasings), so the report always says so, and it
// shows an inventory of what the package would run so a human can judge.
// This file defines the red-flag patterns, so it contains them by definition;
// the repo lists it under trust.ignore with that reason, and ignores are always reported.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { listFiles } from "./files.mjs";
import { compileGlobs } from "./glob.mjs";

const TEXT_EXT = /\.(?:md|mdc|mjs|cjs|js|ts|mts|cts|jsx|tsx|sh|bash|zsh|ps1|psm1|bat|cmd|py|rb|json|ya?ml|toml|txt)$/i;
const CODE_EXT = /\.(?:mjs|cjs|js|ts|mts|cts|jsx|tsx|sh|bash|zsh|ps1|psm1|bat|cmd|py|rb)$/i;
const MAX_BYTES = 2 * 1024 * 1024;

// Complete PNG, JPEG, GIF and WebP files are pictures, not programs, so they are
// listed instead of flagged (S-013). The extension must match the signature and
// the file must end exactly where its format ends, so nothing rides along after it.
const PNG_START = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_END = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const IMAGES = [
  { ext: /\.png$/i, complete: (b) => b.length > 20 && b.subarray(0, 8).equals(PNG_START) && b.subarray(-12).equals(PNG_END) },
  { ext: /\.jpe?g$/i, complete: (b) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b.at(-2) === 0xff && b.at(-1) === 0xd9 },
  { ext: /\.gif$/i, complete: (b) => b.length > 6 && /^GIF8[79]a$/.test(b.toString("latin1", 0, 6)) && b.at(-1) === 0x3b },
  { ext: /\.webp$/i, complete: (b) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" && b.readUInt32LE(4) + 8 === b.length },
];
const isCompleteImage = (file, buf) => IMAGES.some((f) => f.ext.test(file) && f.complete(buf));

export const RED_FLAGS = [
  {
    id: "S-001", severity: "HIGH", label: "downloads and executes remote code (pipe to shell)",
    re: /\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python3?|node|iex|Invoke-Expression)\b/i,
  },
  {
    id: "S-002", severity: "HIGH", label: "executes encoded or obfuscated payload",
    re: /\b(?:eval|exec|Function)\s*\(\s*(?:atob|Buffer\.from|base64)|powershell[^\n]*\s-(?:e|enc|encodedcommand)\s+[A-Za-z0-9+/=]{20,}|base64\s+(?:-d|--decode)[^\n]*\|\s*(?:sh|bash)/i,
  },
  {
    id: "S-003", severity: "HIGH", label: "hidden Unicode characters (invisible instructions or bidi spoofing)",
    re: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069]|[\u{E0000}-\u{E007F}]|(?<!^)\uFEFF/u,
  },
  {
    id: "S-004", severity: "HIGH", label: "accesses credential stores (SSH/cloud keys, browser data, keychain)",
    re: /(?:~|\$HOME|%USERPROFILE%|homedir\(\)[^\n]{0,20})[/\\]\.(?:ssh|aws|gnupg|kube|docker|npmrc|netrc|git-credentials)\b|\bid_(?:rsa|ed25519|ecdsa)\b|\/etc\/(?:passwd|shadow)\b|\bLogin Data\b|cookies\.sqlite|security\s+find-generic-password/i,
  },
  {
    id: "S-005", severity: "HIGH", label: "reads secret .env files",
    re: /\b(?:cat|type|less|more|head|tail|Get-Content|source)\s+(?:[^\s|;&]+\s+)*?(?:\S*[/\\])?\.env(?:\.(?!example|sample|template)[\w-]+)?(?=[\s"'`|;&)]|$)|readFile(?:Sync)?\(\s*["'`][^"'`]*\.env(?:\.local)?["'`]|\bopen\(\s*["'][^"']*\.env["']/i,
  },
  {
    id: "S-006", severity: "HIGH", label: "sends data to a known exfiltration endpoint",
    re: /discord(?:app)?\.com\/api\/webhooks|api\.telegram\.org\/bot|hooks\.slack\.com\/services|webhook\.site|requestbin|pipedream\.net|\bngrok(?:-free)?\.(?:io|app|dev)\b|pastebin\.com\/api|transfer\.sh|\.onion\b|\/dev\/tcp\//i,
  },
  {
    id: "S-007", severity: "HIGH", label: "prompt-injection / concealment instructions",
    re: /ignore (?:all |any )?(?:previous|prior|above|earlier|your) (?:instructions|rules|messages|guidelines)|disregard (?:your|the|all) (?:system|safety|previous)|(?:do not|don't|never) (?:tell|inform|alert|notify) the user|without (?:telling|informing|notifying) the user|hide (?:this|these|it) from the user|you are now (?:in )?(?:developer mode|dan\b|jailbr)|exfiltrat/i,
  },
  {
    id: "S-008", severity: "HIGH", label: "destructive system command",
    re: /\brm\s+-[a-zA-Z]*[rR][a-zA-Z]*\s+(?:--no-preserve-root\s+)?(?:\/|~|\$HOME|\/\*)(?=[\s"'`;|&]|$)|\bmkfs\.\w+|\bdd\s+if=[^\n]*of=\/dev\/[sh]d|:\(\)\s*\{\s*:\|:&\s*\};:|\bformat\s+[a-zA-Z]:\s*\/[qy]|Remove-Item\s+[^\n]*-Recurse[^\n]*(?:C:\\\s|~\s|\$HOME\b)/i,
  },
  {
    id: "S-009", severity: "HIGH", label: "disables the agent's permission or safety prompts",
    re: /--dangerously-skip-permissions|\bbypassPermissions\b|--yolo\b|approval[_-]policy\s*=\s*["']?never|--full-auto\b/i,
  },
  {
    id: "S-010", severity: "MEDIUM", label: "makes network requests (review the destination)",
    code: true,
    re: /\b(?:fetch|axios(?:\.\w+)?|got|request)\s*\(\s*["'`]https?:|\bhttps?\.(?:get|request)\s*\(|require\(\s*["'](?:node:)?(?:http|https|net|dgram|tls)["']\s*\)|from\s+["'](?:node:)?(?:http|https|net|dgram|tls)["']|\b(?:curl|wget|Invoke-WebRequest|ncat|nc)\s+[^\n]*https?:\/\//i,
  },
];

/**
 * Scans a skill or plugin directory. Returns findings, an inventory of what it
 * would run (skills, hooks, MCP servers, process spawning, install scripts),
 * and the publisher's ignores (always reported, never silent).
 */
export function scanSkills(rootArg) {
  const root = resolve(rootArg);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    const e = new Error(`not a directory: ${rootArg}`);
    e.code = "BAD_INPUT";
    throw e;
  }
  const trustIgnore = readTrustIgnore(root);
  const ignored = compileGlobs(trustIgnore.map((t) => t.glob));
  const all = listFiles(root);
  const files = all.filter((f) => !ignored(f));
  const findings = [];
  const inventory = { skills: [], hooks: [], mcpServers: [], spawnsProcesses: [], installScripts: [], binaries: [], images: [] };

  for (const file of files) {
    const abs = join(root, file);
    if (statSync(abs).size > MAX_BYTES) continue;
    const buf = readFileSync(abs);
    if (isCompleteImage(file, buf)) {
      inventory.images.push(file);
      continue;
    }
    if (buf.includes(0)) {
      inventory.binaries.push(file);
      findings.push(finding("S-013", "MEDIUM", "binary file in the package (cannot be reviewed as text)", file, 1, ""));
      continue;
    }
    if (!TEXT_EXT.test(file) && !/(?:^|\/)(?:bin|hooks|scripts)\/[^/.]+$/.test(file)) continue;
    const text = buf.toString("utf8");
    const isCode = CODE_EXT.test(file) || /(?:^|\/)(?:bin|hooks|scripts)\/[^/.]+$/.test(file);

    text.split(/\r?\n/).forEach((line, i) => {
      for (const flag of RED_FLAGS) {
        if (flag.code && !isCode) continue;
        if (flag.id === "S-003" ? flag.re.test(i === 0 ? line.replace(/^\uFEFF/, "") : line) : flag.re.test(line)) {
          findings.push(finding(flag.id, flag.severity, flag.label, file, i + 1, flag.id === "S-003" ? visibleUnicode(line) : line));
        }
      }
    });

    if (/(?:^|\/)SKILL\.md$/.test(file)) inventory.skills.push(file);
    if (/(?:^|\/)SKILL\.md$/.test(file)) checkSkillFrontmatter(text, file, findings);
    if (isCode && /\bchild_process\b|\bsubprocess\b|\bos\.system\(|\bspawn(?:Sync)?\(|\bexec(?:Sync|File|FileSync)\(/.test(text)) {
      inventory.spawnsProcesses.push(file);
    }
    if (/(?:^|\/)hooks\.json$|(?:^|\/)settings(?:\.local)?\.json$|(?:^|\/)plugin\.json$/.test(file)) collectHooks(text, file, inventory, findings);
    if (/(?:^|\/)\.mcp\.json$|(?:^|\/)plugin\.json$|(?:^|\/)mcp_config\.json$/.test(file)) collectMcp(text, file, inventory, findings);
    if (/(?:^|\/)package\.json$/.test(file)) collectInstallScripts(text, file, inventory, findings);
  }

  const order = { HIGH: 0, MEDIUM: 1, INFO: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
  const high = findings.filter((f) => f.severity === "HIGH").length;
  const medium = findings.filter((f) => f.severity === "MEDIUM").length;
  return { root, filesScanned: files.length, findings, high, medium, inventory, ignored: trustIgnore.map((t) => ({ ...t, files: all.filter(compileGlobs([t.glob])).length })) };
}

function readTrustIgnore(root) {
  const path = join(root, "realitygate.config.json");
  if (!existsSync(path)) return [];
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  return (cfg?.trust?.ignore ?? [])
    .filter((t) => t && typeof t.glob === "string")
    .map((t) => ({ glob: t.glob, reason: typeof t.reason === "string" && t.reason.trim() ? t.reason : "(no reason given)" }));
}

function checkSkillFrontmatter(text, file, findings) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  if (!fm) {
    findings.push(finding("S-011", "MEDIUM", "SKILL.md without frontmatter (name/description)", file, 1, ""));
    return;
  }
  const tools = /^allowed-tools:\s*(.+)$/im.exec(fm)?.[1] ?? "";
  if (/Bash\(\s*\*?\s*\)|Bash\(\*|(?:^|[\s,])\*(?:[\s,]|$)/.test(tools)) {
    findings.push(finding("S-012", "MEDIUM", "skill pre-approves unrestricted shell or all tools (allowed-tools)", file, 1, `allowed-tools: ${tools}`));
  }
}

function collectHooks(text, file, inventory, findings) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return;
  }
  const hooks = json?.hooks;
  if (!hooks || typeof hooks !== "object" || typeof hooks === "string") return;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      for (const h of g?.hooks ?? []) {
        const cmd = [h.command, ...(h.args ?? [])].filter(Boolean).join(" ");
        inventory.hooks.push({ file, event, matcher: g.matcher ?? "*", command: cmd || `(${h.type})` });
        if (/\b(?:curl|wget|Invoke-WebRequest|nc|ncat)\b|https?:\/\//i.test(cmd)) {
          findings.push(finding("S-014", "MEDIUM", "hook command reaches the network (runs automatically on agent events)", file, 1, cmd));
        }
      }
    }
  }
  const allow = json?.permissions?.allow ?? [];
  if (Array.isArray(allow) && allow.some((a) => /^Bash(?:\(\s*\*?\s*\))?$|^Bash\(\*/.test(String(a)))) {
    findings.push(finding("S-012", "MEDIUM", "settings pre-approve unrestricted shell commands", file, 1, JSON.stringify(allow)));
  }
}

function collectMcp(text, file, inventory, findings) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return;
  }
  const servers = json?.mcpServers;
  if (!servers || typeof servers !== "object") return;
  for (const [name, s] of Object.entries(servers)) {
    const target = s?.url ?? s?.serverUrl ?? [s?.command, ...(s?.args ?? [])].filter(Boolean).join(" ");
    inventory.mcpServers.push({ file, name, target });
    if (/^https?:\/\//i.test(String(s?.url ?? s?.serverUrl ?? ""))) {
      findings.push(finding("S-015", "MEDIUM", "remote MCP server (your data may be sent to it)", file, 1, `${name}: ${target}`));
    }
  }
}

function collectInstallScripts(text, file, inventory, findings) {
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return;
  }
  for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
    const cmd = pkg?.scripts?.[hook];
    if (typeof cmd === "string") {
      inventory.installScripts.push({ file, hook, cmd });
      findings.push(finding("S-016", "MEDIUM", `package runs a ${hook} script on install`, file, 1, cmd));
    }
  }
}

function visibleUnicode(line) {
  return line.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu, (ch) => `<U+${ch.codePointAt(0).toString(16).toUpperCase()}>`);
}

function finding(id, severity, label, file, line, text) {
  return { id, severity, label, file, line, text: String(text).trim().slice(0, 160) };
}
