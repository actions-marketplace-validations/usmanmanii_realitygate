import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { KIT } from "./helpers.mjs";

const read = (path) => readFileSync(join(KIT, path), "utf8");
const packageVersion = JSON.parse(read("package.json")).version;

function markdownFiles(dir) {
  return readdirSync(join(KIT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

describe("release metadata", () => {
  test("package, plugin, and citation versions match", () => {
    const pluginVersion = JSON.parse(read(".claude-plugin/plugin.json")).version;
    const citation = read("CITATION.cff");
    const citationVersion = /^version:\s*['"]?([^\s'"]+)['"]?\s*$/m.exec(citation)?.[1];
    const releaseDate = /^date-released:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(citation)?.[1];
    assert.match(packageVersion, /^\d+\.\d+\.\d+$/);
    assert.equal(pluginVersion, packageVersion);
    assert.equal(citationVersion, packageVersion);
    assert.ok(releaseDate && !Number.isNaN(Date.parse(releaseDate)), "CITATION.cff needs a valid date-released");
  });

  test("every current GitHub Action version reference matches the package", () => {
    const files = ["README.md", "llms.txt", ...markdownFiles("skills"), ...markdownFiles("agent-skills"), ...markdownFiles("docs")];
    const pattern = /usmanmanii\/realitygate@v(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/g;
    let count = 0;
    for (const file of files) {
      for (const match of read(file).matchAll(pattern)) {
        assert.equal(match[1], packageVersion, `${relative(KIT, join(KIT, file))}: ${match[0]}`);
        count++;
      }
    }
    assert.ok(count > 0, "expected at least one pinned GitHub Action reference");
  });
});
