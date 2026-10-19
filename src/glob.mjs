// Minimal glob → RegExp for repo-relative POSIX paths.
// Supports `**`, `*`, `?` and `{a,b}`; everything else is literal.

export function globToRegExp(glob) {
  let re = "";
  let i = 0;
  let braceDepth = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const atSegmentStart = i === 0 || glob[i - 1] === "/";
        if (atSegmentStart && glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 3;
          continue;
        }
        re += ".*";
        i += 2;
        continue;
      }
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      braceDepth++;
      re += "(?:";
    } else if (c === "}" && braceDepth > 0) {
      braceDepth--;
      re += ")";
    } else if (c === "," && braceDepth > 0) {
      re += "|";
    } else {
      re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
    }
    i++;
  }
  return new RegExp(`^${re}$`);
}

export function compileGlobs(globs) {
  const regexes = globs.map(globToRegExp);
  return (path) => regexes.some((r) => r.test(path));
}

/** The literal directory prefix of a glob, e.g. `apps/web/src/**` → `apps/web/src`. */
export function staticPrefix(glob) {
  const out = [];
  for (const seg of glob.split("/")) {
    if (/[*?{]/.test(seg)) break;
    out.push(seg);
  }
  return out.join("/");
}
