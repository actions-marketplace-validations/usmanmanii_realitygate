#!/usr/bin/env node
// Regenerates agent-skills/ (portable Agent Skills for Codex, Antigravity CLI and
// other SKILL.md tools) from the Claude Code plugin skills in skills/.
// tests/agents.test.mjs fails if the two drift apart.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { portableSkills } from "../src/agents.mjs";
import { KIT_ROOT } from "../src/init.mjs";

for (const skill of portableSkills()) {
  const dir = join(KIT_ROOT, "agent-skills", skill.dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skill.content);
  process.stdout.write(`agent-skills/${skill.dir}/SKILL.md\n`);
}
