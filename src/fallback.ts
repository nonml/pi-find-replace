/**
 * Pure JavaScript fallback scanner.
 *
 * Used when ripgrep is unavailable (no bundled binary, no system `rg`).
 * Slower than ripgrep but works everywhere with zero native dependencies.
 */

import { readFileSync, statSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { RgResult, RgContextLine, RgOptions } from "./rg.js";

// ---------------------------------------------------------------------------
// Glob matching (minimal implementation)
// ---------------------------------------------------------------------------

/**
 * Convert a glob pattern to a regex.
 * Supports: *, **, ?, [seq], [!seq]
 */
function globToRegex(pattern: string): RegExp {
  let regex = "^";
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // ** matches everything including /
        regex += ".*";
        i += 2;
        // Skip following / if present
        if (pattern[i] === "/") i++;
      } else {
        // * matches everything except /
        regex += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      regex += "[^/]";
      i++;
    } else if (ch === "[") {
      // Character class
      let end = pattern.indexOf("]", i + 1);
      if (end === -1) end = pattern.length;
      let classContent = pattern.slice(i + 1, end);
      if (classContent.startsWith("!")) {
        classContent = "^" + classContent.slice(1);
      }
      regex += "[" + classContent + "]";
      i = end + 1;
    } else if (".+^${}|()\\.".includes(ch)) {
      regex += "\\" + ch;
      i++;
    } else {
      // Handle path separators
      if (ch === "/") {
        regex += sep === "\\" ? "\\\\" : "/";
      } else {
        regex += ch;
      }
      i++;
    }
  }

  regex += "$";
  return new RegExp(regex, "i"); // case-insensitive for Windows
}

// ---------------------------------------------------------------------------
// File tree walking
// ---------------------------------------------------------------------------

async function walkDir(
  dir: string,
  includeGlobs: string[] = [],
  excludeGlobs: string[] = [],
  maxFiles: number = 10000,
): Promise<string[]> {
  const files: string[] = [];
  const includeRegexes = includeGlobs.map((g) => globToRegex(g));
  const excludeRegexes = excludeGlobs.map((g) => globToRegex(g));

  const shouldInclude = (filePath: string): boolean => {
    if (includeRegexes.length > 0) {
      const relPath = filePath.replace(/\\/g, "/");
      if (!includeRegexes.some((r) => r.test(relPath))) return false;
    }
    if (excludeRegexes.length > 0) {
      const relPath = filePath.replace(/\\/g, "/");
      if (excludeRegexes.some((r) => r.test(relPath))) return false;
    }
    return true;
  };

  // Skip .git, node_modules, and other common directories
  const skipDirs = new Set([".git", "node_modules", ".pi", "dist", "build"]);

  async function walk(currentDir: string): Promise<void> {
    if (files.length >= maxFiles) return;

    try {
      const entries = await readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (files.length >= maxFiles) return;

        const fullPath = resolve(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (skipDirs.has(entry.name)) continue;
          await walk(fullPath);
        } else if (entry.isFile()) {
          try {
            statSync(fullPath); // Check if readable
            if (shouldInclude(fullPath)) {
              files.push(fullPath);
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  await walk(dir);
  return files;
}

// ---------------------------------------------------------------------------
// Search within files
// ---------------------------------------------------------------------------

/**
 * Search for a pattern in file content.
 */
function searchInContent(
  content: string,
  query: string,
  isRegex: boolean,
  matchCase: boolean,
  matchWholeWord: boolean,
  contextLines: number,
  maxResults: number | undefined,
): RgContextLine[] {
  const lines = content.split("\n");
  const results: RgContextLine[] = [];
  let matchCount = 0;

  // Build the search regex
  let regex: RegExp;
  const flags = ["g", !matchCase ? "i" : ""].join("");

  if (isRegex) {
    const wordBoundary = matchWholeWord ? `\\b(${query})\\b` : query;
    regex = new RegExp(wordBoundary, flags);
  } else {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordBoundary = matchWholeWord ? `\\b${escaped}\\b` : escaped;
    regex = new RegExp(wordBoundary, flags);
  }

  for (let i = 0; i < lines.length; i++) {
    if (maxResults && matchCount >= maxResults) break;

    const line = lines[i];
    regex.lastIndex = 0; // Reset for .test()

    if (regex.test(line)) {
      matchCount++;
      results.push({ line: i + 1, text: line, kind: "match" });

      // Add context lines
      if (contextLines > 0) {
        // Context before
        for (let j = Math.max(0, i - contextLines); j < i; j++) {
          if (!results.some((r) => r.line === j + 1)) {
            results.push({ line: j + 1, text: lines[j], kind: "context" });
          }
        }
        // Context after
        for (let j = i + 1; j < Math.min(lines.length, i + 1 + contextLines); j++) {
          if (!results.some((r) => r.line === j + 1)) {
            results.push({ line: j + 1, text: lines[j], kind: "context" });
          }
        }
      }
    }
  }

  // Sort by line number
  results.sort((a, b) => a.line - b.line);

  return results;
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Pure JavaScript fallback for ripgrep.
 * Scans files using Node.js fs and regex matching.
 */
export async function searchFallback(opts: RgOptions): Promise<RgResult[]> {
  const searchDir = opts.cwd || process.cwd();
  const contextLines = opts.contextLines || 0;

  // Collect files
  let files: string[] = [];

  if (opts.filePattern) {
    files = await walkDir(
      searchDir,
      [opts.filePattern],
      opts.excludeGlobs || [],
      10000,
    );
  } else {
    files = await walkDir(
      searchDir,
      opts.includeGlobs || [],
      opts.excludeGlobs || [],
      10000,
    );
  }

  const results: RgResult[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(file, "utf-8");
      const matches = searchInContent(
        content,
        opts.query,
        opts.isRegex ?? false,
        opts.matchCase ?? false,
        opts.matchWholeWord ?? false,
        contextLines,
        opts.maxResults,
      );

      if (matches.length > 0) {
        results.push({ file, matches });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}

/**
 * Check if the fallback scanner is available (always true for pure JS).
 */
export function isFallbackAvailable(): boolean {
  return true;
}
