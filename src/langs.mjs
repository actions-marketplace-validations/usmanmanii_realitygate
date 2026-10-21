// Python and Go imports: what a file imports, and whether the project
// declares it (R-014). Like the JS resolver, each only runs when the project
// has a dependency manifest, and anything that could be local counts as local.

import { posix } from "node:path";
import { readText } from "./files.mjs";

const { basename, dirname } = posix;

// sys.stdlib_module_names from CPython 3.13, plus modules removed in 3.12/3.13
// (asynchat, distutils, imp, cgi, telnetlib, …) that older projects still import.
const PY_STDLIB = new Set(
  (
    "abc antigravity argparse array ast asyncio atexit base64 bdb binascii bisect builtins bz2 cProfile calendar cmath cmd code codecs codeop " +
    "collections colorsys compileall concurrent configparser contextlib contextvars copy copyreg csv ctypes curses dataclasses datetime dbm " +
    "decimal difflib dis doctest email encodings ensurepip enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc " +
    "genericpath getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http idlelib imaplib importlib inspect io ipaddress " +
    "itertools json keyword linecache locale logging lzma mailbox marshal math mimetypes mmap modulefinder msvcrt multiprocessing netrc nt " +
    "ntpath nturl2path numbers opcode operator optparse os pathlib pdb pickle pickletools pkgutil platform plistlib poplib posix posixpath pprint " +
    "profile pstats pty pwd py_compile pyclbr pydoc pydoc_data pyexpat queue quopri random re readline reprlib resource rlcompleter runpy sched " +
    "secrets select selectors shelve shlex shutil signal site smtplib socket socketserver sqlite3 sre_compile sre_constants sre_parse ssl stat " +
    // "sub" + "process": the module name alone would list this file as one that starts processes (scan-skills).
    "statistics string stringprep struct sub" + "process symtable sys sysconfig syslog tabnanny tarfile tempfile termios textwrap this threading time " +
    "timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle turtledemo types typing unicodedata unittest urllib uuid venv " +
    "warnings wave weakref webbrowser winreg winsound wsgiref xml xmlrpc zipapp zipfile zipimport zlib zoneinfo " +
    "asynchat asyncore distutils imp smtpd aifc audioop cgi cgitb chunk crypt imghdr mailcap msilib nis nntplib ossaudiodev pipes sndhdr spwd " +
    "sunau telnetlib uu xdrlib lib2to3"
  ).split(" "),
);

// Distributions whose import name differs from the distribution name.
const PY_ALIASES = {
  pillow: ["PIL"], pyyaml: ["yaml"], beautifulsoup4: ["bs4"], "scikit-learn": ["sklearn"], "scikit-image": ["skimage"],
  "opencv-python": ["cv2"], "opencv-python-headless": ["cv2"], "opencv-contrib-python": ["cv2"], "python-dotenv": ["dotenv"],
  protobuf: ["google"], attrs: ["attr", "attrs"], "python-dateutil": ["dateutil"], pyjwt: ["jwt"], "psycopg2-binary": ["psycopg2"],
  "psycopg-binary": ["psycopg"], pymongo: ["pymongo", "bson", "gridfs"], "typing-extensions": ["typing_extensions"],
  "python-multipart": ["multipart", "python_multipart"], grpcio: ["grpc"], pycryptodome: ["Crypto"], pycryptodomex: ["Cryptodome"],
  pyserial: ["serial"], pywin32: ["win32api", "win32con", "win32gui", "pywintypes", "win32com"], "discord.py": ["discord"],
  "faiss-cpu": ["faiss"], "faiss-gpu": ["faiss"], mysqlclient: ["MySQLdb"], "python-jose": ["jose"], "ruamel.yaml": ["ruamel"],
  "google-api-python-client": ["googleapiclient"], pyzmq: ["zmq"], "python-magic": ["magic"], "python-slugify": ["slugify"],
  "python-socketio": ["socketio"], "python-engineio": ["engineio"], "msgpack-python": ["msgpack"], pyopenssl: ["OpenSSL"],
  "pyside6": ["PySide6"], pyqt5: ["PyQt5"], pyqt6: ["PyQt6"], "tensorflow-cpu": ["tensorflow"], "torch-geometric": ["torch_geometric"],
  "pytest-asyncio": ["pytest_asyncio"], setuptools: ["setuptools", "pkg_resources"], "django-environ": ["environ"],
  "djangorestframework": ["rest_framework"], "django-cors-headers": ["corsheaders"], "markdown": ["markdown"], "pygithub": ["github"],
  "websocket-client": ["websocket"], "apache-airflow": ["airflow"], "azure-storage-blob": ["azure"], "llama-index": ["llama_index"],
};

const norm = (name) => name.toLowerCase().replace(/[-_.]+/g, "_");

/** Top-level Python imports (indented imports are optional or lazy, so they are skipped). */
export function extractPythonImports(content) {
  const found = [];
  content.split(/\r?\n/).forEach((line, i) => {
    let m = /^import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)\s*(?:#.*)?$/.exec(line);
    if (m) {
      for (const part of m[1].split(",")) found.push({ specifier: part.trim().split(/\s+/)[0], line: i + 1 });
      return;
    }
    m = /^from\s+([\w.]+)\s+import\b/.exec(line);
    if (m && !m[1].startsWith(".")) found.push({ specifier: m[1], line: i + 1 });
  });
  return found;
}

/** Go imports, single and grouped. */
export function extractGoImports(content) {
  const found = [];
  let inBlock = false;
  content.split(/\r?\n/).forEach((line, i) => {
    if (inBlock) {
      if (/^\s*\)/.test(line)) inBlock = false;
      else {
        const m = /^\s*(?:[\w.]+\s+)?"([^"]+)"/.exec(line);
        if (m) found.push({ specifier: m[1], line: i + 1 });
      }
      return;
    }
    if (/^\s*import\s*\(\s*$/.test(line)) {
      inBlock = true;
      return;
    }
    const m = /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/.exec(line);
    if (m) found.push({ specifier: m[1], line: i + 1 });
  });
  return found;
}

function requirementName(spec) {
  return /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec)?.[1] ?? null;
}

/** True for the Python files that declare dependencies. */
export function isPythonManifest(path) {
  const name = basename(path);
  return /^requirements[\w.-]*\.(?:txt|in)$/.test(name) || /(?:^|\/)requirements\/[\w.-]+\.(?:txt|in)$/.test(path) || ["pyproject.toml", "Pipfile", "setup.py", "setup.cfg"].includes(name);
}

/**
 * Distribution names one Python manifest declares. `buildSystem: false` leaves
 * out pyproject's [build-system] requires, which lockfiles don't record.
 */
export function pythonManifestDeps(path, text, { buildSystem = true } = {}) {
  const name = basename(path);
  const names = new Set();
  if (name === "pyproject.toml" || name === "Pipfile") {
    const source = buildSystem ? text : withoutTomlSection(text, "build-system");
    parseTomlDeps(source, name === "Pipfile").forEach((n) => names.add(n));
  } else if (name === "setup.py") {
    const block = /install_requires\s*=\s*\[([\s\S]*?)\]/.exec(text)?.[1] ?? "";
    for (const m of block.matchAll(/["']([^"']+)["']/g)) if (requirementName(m[1])) names.add(requirementName(m[1]));
  } else if (name === "setup.cfg") {
    const block = /install_requires\s*=\s*((?:.*\n?)(?:[ \t]+.*\n?)*)/.exec(text)?.[1] ?? "";
    for (const line of block.split(/\r?\n/)) if (requirementName(line)) names.add(requirementName(line));
  } else {
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*(?:#|-)/.test(line)) continue;
      const n = requirementName(line.replace(/#.*$/, ""));
      if (n) names.add(n);
    }
  }
  return names;
}

function withoutTomlSection(text, section) {
  let skipping = false;
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const header = /^\s*\[\[?([^\]]+)\]\]?\s*$/.exec(line);
      if (header) skipping = header[1].trim() === section;
      return !skipping;
    })
    .join("\n");
}

/** Distribution names from requirements*.txt, pyproject.toml, Pipfile, setup.py and setup.cfg. */
function pythonDistributions(root, files) {
  const names = new Set();
  let manifests = 0;
  for (const f of files) {
    if (!isPythonManifest(f)) continue;
    const text = readText(root, f);
    if (text === null) continue;
    manifests++;
    pythonManifestDeps(f, text).forEach((n) => names.add(n));
  }
  return { names, manifests };
}

/** Dependency names from the dependency sections of pyproject.toml (PEP 621, uv, PDM, Poetry) or a Pipfile. */
function parseTomlDeps(text, pipfile) {
  const names = new Set();
  let section = "";
  let arrayKey = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    const header = /^\s*\[\[?([^\]]+)\]\]?\s*$/.exec(line);
    if (header) {
      section = header[1].trim();
      arrayKey = null;
      continue;
    }
    const arraySection = section === "project" || section === "project.optional-dependencies" || section === "dependency-groups" || section === "tool.uv" || section === "tool.pdm.dev-dependencies" || section === "build-system";
    const keySection = pipfile ? section === "packages" || section === "dev-packages" : /^tool\.poetry(?:\.group\.[^.]+)?\.(?:dev-)?dependencies$/.test(section);
    if (arrayKey !== null) {
      for (const m of line.matchAll(/["']([^"']+)["']/g)) if (requirementName(m[1])) names.add(requirementName(m[1]));
      if (line.includes("]")) arrayKey = null;
      continue;
    }
    const kv = /^\s*["']?([A-Za-z0-9._-]+)["']?\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (keySection) {
      if (kv[1] !== "python") names.add(kv[1]);
      continue;
    }
    if (!arraySection || !kv[2].startsWith("[")) continue;
    const wanted =
      section === "project" ? kv[1] === "dependencies" : section === "tool.uv" ? kv[1] === "dev-dependencies" : section === "build-system" ? kv[1] === "requires" : true;
    if (!wanted) continue;
    for (const m of kv[2].matchAll(/["']([^"']+)["']/g)) if (requirementName(m[1])) names.add(requirementName(m[1]));
    if (!kv[2].includes("]")) arrayKey = kv[1];
  }
  return names;
}

export function buildPythonResolver(root, files) {
  const { names, manifests } = pythonDistributions(root, files);
  const importable = new Set();
  // Installed by the framework itself, like next's server-only in the JS resolver.
  if ([...names].some((n) => n.toLowerCase() === "fastapi")) importable.add("starlette");
  for (const dist of names) {
    importable.add(norm(dist));
    // Namespace families (google-cloud-storage → google, azure-identity → azure).
    importable.add(norm(dist.split(/[-.]/)[0]));
    for (const alias of PY_ALIASES[dist.toLowerCase()] ?? []) importable.add(norm(alias));
  }
  // Anything that could be the project's own package: every directory and module name.
  const local = new Set();
  for (const f of files) {
    for (const seg of dirname(f).split("/")) if (seg && seg !== ".") local.add(norm(seg));
    if (f.endsWith(".py") || f.endsWith(".pyi")) local.add(norm(basename(f).replace(/\.pyi?$/, "")));
  }
  return {
    active: manifests > 0,
    isDeclared(_file, specifier) {
      const top = specifier.split(".")[0];
      if (top.startsWith("_") || PY_STDLIB.has(top)) return true;
      return importable.has(norm(top)) || local.has(norm(top));
    },
  };
}

export function buildGoResolver(root, files) {
  const modules = new Set();
  const requires = new Set();
  let manifests = 0;
  for (const f of files) {
    if (basename(f) !== "go.mod") continue;
    const text = readText(root, f);
    if (text === null) continue;
    manifests++;
    const mod = /^\s*module\s+(\S+)/m.exec(text)?.[1];
    if (mod) modules.add(mod.replace(/^"|"$/g, ""));
    let block = null;
    for (const line of text.split(/\r?\n/)) {
      const open = /^\s*(require|replace)\s*\(\s*$/.exec(line);
      if (open) {
        block = open[1];
        continue;
      }
      if (block && /^\s*\)/.test(line)) {
        block = null;
        continue;
      }
      const single = /^\s*(?:require|replace)\s+(\S+)/.exec(line);
      const inner = block ? /^\s*(\S+)\s/.exec(line) : null;
      const path = (single ?? inner)?.[1];
      if (path && !path.startsWith("//")) requires.add(path);
    }
  }
  return {
    active: manifests > 0,
    isDeclared(_file, path) {
      const first = path.split("/")[0];
      if (!first.includes(".")) return true; // standard library ("fmt", "net/http") or "C"
      const under = (p) => path === p || path.startsWith(`${p}/`);
      return [...modules].some(under) || [...requires].some(under);
    },
  };
}
