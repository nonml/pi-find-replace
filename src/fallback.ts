/**
 * Pure JavaScript fallback scanner.
 *
 * Used when ripgrep is unavailable (no bundled binary, no system `rg`),
 * e.g. in Pi sub-agent processes. Slower than ripgrep but works everywhere
 * with zero native dependencies.
 *
 * Mirrors ripgrep's default filtering so it walks the same files:
 * hidden entries are skipped and `.gitignore` / `.ignore` files are
 * honoured. On top of that it enforces hard budgets (files, directory
 * entries, file size, output size, time) so a pathological tree can't
 * exhaust the V8 heap.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { compileGlob, matchRules, parseIgnoreFile, type IgnoreRule } from "./ignore.js";
import { SEARCH_TIMEOUT_MS, type RgResult, type RgContextLine, type RgOptions } from "./rg.js";

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export const FALLBACK_LIMITS = {
  /** Max files whose contents are searched. */
  maxFiles: 10000,
  /** Max directory entries visited (files + dirs), bounds the walk itself. */
  maxEntries: 200000,
  /** Files larger than this are skipped — almost always generated/binary. */
  maxFileBytes: 4 * 1024 * 1024,
  /** Stop collecting once this much line text is buffered (rg tier's maxBuffer). */
  maxOutputBytes: 10 * 1024 * 1024,
};

/**
 * Directories skipped even without a `.gitignore` entry. Hidden
 * directories (`.git`, `.dart_tool`, `.gradle`, `.venv`, ...) are already
 * skipped like ripgrep does; these are the common non-hidden heavy ones.
 */
export const SKIP_DIRS = new Set([
  "node_modules",
  "bower_components",
  "dist",
  "build",
  "Pods",
  "Carthage",
  "DerivedData",
  "__pycache__",
  "venv",
]);

const IGNORE_FILES = [".gitignore", ".ignore"];

// ---------------------------------------------------------------------------
// Ignore rules
// ---------------------------------------------------------------------------

interface IgnoreLayer {
  base: string;
  rules: IgnoreRule[];
}

function toPosix(p: string): string {
  return sep === "\\" ? p.replace(/\\/g, "/") : p;
}

function isIgnored(layers: IgnoreLayer[], fullPath: string, isDir: boolean): boolean {
  let ignored = false;
  // Deeper layers come later and take precedence
  for (const layer of layers) {
    const verdict = matchRules(layer.rules, toPosix(relative(layer.base, fullPath)), isDir);
    if (verdict !== undefined) ignored = verdict;
  }
  return ignored;
}

async function readIgnoreFile(path: string): Promise<IgnoreRule[]> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > 1024 * 1024) return [];
    return parseIgnoreFile(await readFile(path, "utf-8"));
  } catch {
    return [];
  }
}

/**
 * Ignore layers from the enclosing git repo, for when the search starts
 * below the repo root: `.git/info/exclude`, then `.gitignore` / `.ignore`
 * from the root down to (not including) the search directory.
 */
async function loadAncestorLayers(searchDir: string): Promise<IgnoreLayer[]> {
  const ancestors: string[] = [];
  let dir = searchDir;
  let repoRoot: string | null = null;

  while (true) {
    if (existsSync(join(dir, ".git"))) {
      repoRoot = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
    ancestors.unshift(dir);
  }

  if (!repoRoot) return [];

  const layers: IgnoreLayer[] = [];
  const exclude = await readIgnoreFile(join(repoRoot, ".git", "info", "exclude"));
  if (exclude.length > 0) layers.push({ base: repoRoot, rules: exclude });

  for (const ancestor of ancestors) {
    for (const name of IGNORE_FILES) {
      const rules = await readIgnoreFile(join(ancestor, name));
      if (rules.length > 0) layers.push({ base: ancestor, rules });
    }
  }
  return layers;
}

// ---------------------------------------------------------------------------
// Query compilation
// ---------------------------------------------------------------------------

/**
 * ripgrep's --smart-case: case-insensitive unless the pattern contains an
 * uppercase literal (escape sequences like `\S` or `\W` don't count).
 */
function hasUppercaseLiteral(query: string, isRegex: boolean): boolean {
  const literal = isRegex ? query.replace(/\\./g, "") : query;
  return literal !== literal.toLowerCase();
}

export function compileQuery(opts: RgOptions): RegExp {
  const isRegex = opts.isRegex ?? false;
  let source = isRegex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  if (opts.matchWholeWord) {
    // Like rg -w: the match must not be flanked by word characters. Unlike
    // \b this also works when the query starts/ends with a non-word char.
    source = `(?<![A-Za-z0-9_])(?:${source})(?![A-Za-z0-9_])`;
  }

  const caseInsensitive = !opts.matchCase && !hasUppercaseLiteral(opts.query, isRegex);

  try {
    return new RegExp(source, caseInsensitive ? "i" : "");
  } catch (err) {
    throw new Error(`Invalid regex "${opts.query}": ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Search within files
// ---------------------------------------------------------------------------

/**
 * Search file content line by line, returning matches plus context lines.
 * `maxResults` caps matches per file, like `rg --max-count`.
 */
export function searchInContent(
  content: string,
  regex: RegExp,
  contextLines: number,
  maxResults: number | undefined,
): RgContextLine[] {
  const lines = content.split("\n");
  // A trailing newline terminates the last line; it doesn't start a new one
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const matchIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (maxResults && matchIdx.length >= maxResults) break;
    if (regex.test(stripCr(lines[i]))) matchIdx.push(i);
  }
  if (matchIdx.length === 0) return [];

  const byLine = new Map<number, RgContextLine>();
  for (const i of matchIdx) {
    byLine.set(i, { line: i + 1, text: stripCr(lines[i]), kind: "match" });
  }
  if (contextLines > 0) {
    for (const i of matchIdx) {
      const from = Math.max(0, i - contextLines);
      const to = Math.min(lines.length - 1, i + contextLines);
      for (let j = from; j <= to; j++) {
        if (!byLine.has(j)) {
          byLine.set(j, { line: j + 1, text: stripCr(lines[j]), kind: "context" });
        }
      }
    }
  }

  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Pure JavaScript fallback for ripgrep.
 * Walks the tree with ripgrep's default filtering and regex-matches files.
 * Paths are reported like ripgrep's (`./src/a.ts`, native separator).
 */
export async function searchFallback(opts: RgOptions): Promise<RgResult[]> {
  const searchDir = opts.cwd || process.cwd();
  const contextLines = opts.contextLines || 0;
  const regex = compileQuery(opts);
  const deadline = Date.now() + SEARCH_TIMEOUT_MS;

  const includeGlobs = [...(opts.includeGlobs ?? []), ...(opts.filePattern ? [opts.filePattern] : [])];
  const includeRules = includeGlobs.map(compileGlob).filter((r): r is IgnoreRule => r !== null);
  const excludeRules = (opts.excludeGlobs ?? [])
    .map(compileGlob)
    .filter((r): r is IgnoreRule => r !== null);

  const results: RgResult[] = [];
  let filesSearched = 0;
  let entriesVisited = 0;
  let outputBytes = 0;
  let timedOut = false;

  const budgetLeft = (): boolean => {
    if (Date.now() > deadline) {
      timedOut = true;
      return false;
    }
    return (
      filesSearched < FALLBACK_LIMITS.maxFiles &&
      entriesVisited < FALLBACK_LIMITS.maxEntries &&
      outputBytes < FALLBACK_LIMITS.maxOutputBytes
    );
  };

  async function searchFile(fullPath: string): Promise<void> {
    try {
      const info = await stat(fullPath);
      if (info.size > FALLBACK_LIMITS.maxFileBytes) return;

      const buf = await readFile(fullPath);
      filesSearched++;
      // Same heuristic as ripgrep: a NUL byte means binary
      if (buf.includes(0)) return;

      let content = buf.toString("utf-8");
      if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);

      const matches = searchInContent(content, regex, contextLines, opts.maxResults);
      if (matches.length > 0) {
        for (const m of matches) outputBytes += m.text.length;
        results.push({ file: `.${sep}${relative(searchDir, fullPath)}`, matches });
      }
    } catch {
      // Skip unreadable files
    }
  }

  async function walk(dir: string, layers: IgnoreLayer[]): Promise<void> {
    if (!budgetLeft()) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // Skip unreadable directories
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const names = new Set(entries.map((e) => e.name));
    let dirLayers = layers;
    for (const name of IGNORE_FILES) {
      if (!names.has(name)) continue;
      const rules = await readIgnoreFile(join(dir, name));
      if (rules.length > 0) dirLayers = [...dirLayers, { base: dir, rules }];
    }

    for (const entry of entries) {
      if (!budgetLeft()) return;
      entriesVisited++;

      const isDir = entry.isDirectory();
      // Symlinks and special files aren't followed, matching ripgrep
      if (!isDir && !entry.isFile()) continue;

      const fullPath = join(dir, entry.name);
      const relPath = toPosix(relative(searchDir, fullPath));
      if (matchRules(excludeRules, relPath, isDir)) continue;

      // Hidden entries are skipped by ripgrep by default
      const hidden = entry.name.startsWith(".");

      if (isDir) {
        if (hidden || SKIP_DIRS.has(entry.name)) continue;
        if (isIgnored(dirLayers, fullPath, true)) continue;
        await walk(fullPath, dirLayers);
      } else if (includeRules.length > 0) {
        // Like rg, an include glob match beats hidden/ignore rules for files
        // (ignored directories above are still pruned)
        if (matchRules(includeRules, relPath, false)) await searchFile(fullPath);
      } else {
        if (hidden || isIgnored(dirLayers, fullPath, false)) continue;
        await searchFile(fullPath);
      }
    }
  }

  await walk(searchDir, await loadAncestorLayers(searchDir));

  if (timedOut && results.length === 0) {
    throw new Error(
      `Search timed out after ${SEARCH_TIMEOUT_MS / 1000}s. Narrow it with a scope or include globs.`,
    );
  }

  return results;
}

/**
 * Check if the fallback scanner is available (always true for pure JS).
 */
export function isFallbackAvailable(): boolean {
  return true;
}
