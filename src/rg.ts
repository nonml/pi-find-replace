/**
 * Ripgrep execution and JSON output parsing.
 *
 * All search tools route through here so we get consistent,
 * token-efficient output formatted for an LLM to consume.
 *
 * Uses a 3-tier fallback chain:
 * 1. Bundled ripgrep (@vscode/ripgrep) — auto-installed via npm
 * 2. System ripgrep (`rg`) — installed via package manager
 * 3. Pure JavaScript fallback — zero dependencies, slower
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Bundled ripgrep (@vscode/ripgrep)
// ---------------------------------------------------------------------------

let bundledRgPath: string | null = null;
let bundledRgError: string | null = null;

try {
  // Dynamic import to avoid crashing if package is missing
  const vscodeRg = await import("@vscode/ripgrep");
  if (vscodeRg?.rgPath && existsSync(vscodeRg.rgPath)) {
    bundledRgPath = vscodeRg.rgPath;
  } else {
    bundledRgError = "@vscode/ripgrep resolved but binary not found";
  }
} catch {
  bundledRgError = "@vscode/ripgrep not installed";
}

/**
 * Try to run the bundled ripgrep binary.
 * Returns results or null if bundled binary is unavailable.
 */
async function tryBundledRg(
  rgPath: string,
  args: string[],
  cwd: string | undefined,
): Promise<RgResult[] | null> {
  try {
    const result = await execFileAsync(rgPath, args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000, // 30s timeout
    });
    if (result.stdout.trim() === "") return [];
    return parseRgJson(result.stdout);
  } catch (err: unknown) {
    const error = err as { status?: number; code?: string };
    if (error.status === 1) return []; // no matches
    if (error.code === "ETIMEDOUT") return null; // timeout, try next tier
    return null; // binary failed
  }
}

// ---------------------------------------------------------------------------
// System ripgrep
// ---------------------------------------------------------------------------

/**
 * Try to run the system ripgrep (`rg`).
 * Returns results or null if system rg is unavailable.
 */
async function trySystemRg(
  args: string[],
  cwd: string | undefined,
): Promise<RgResult[] | null> {
  try {
    const result = await execFileAsync("rg", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000, // 30s timeout
    });
    if (result.stdout.trim() === "") return [];
    return parseRgJson(result.stdout);
  } catch (err: unknown) {
    const error = err as { status?: number; code?: string };
    if (error.status === 1) return []; // no matches
    if (error.status === 127) return null; // rg not found
    if (error.code === "ETIMEDOUT") return null; // timeout
    return null; // other error
  }
}

// ---------------------------------------------------------------------------
// Pure JavaScript fallback
// ---------------------------------------------------------------------------

let fallbackImport: typeof import("./fallback.js") | null = null;

async function getFallbackModule(): Promise<typeof import("./fallback.js")> {
  if (!fallbackImport) {
    fallbackImport = await import("./fallback.js");
  }
  return fallbackImport;
}

/**
 * Run the pure JavaScript fallback scanner.
 */
async function tryFallbackRg(opts: RgOptions): Promise<RgResult[]> {
  const mod = await getFallbackModule();
  return mod.searchFallback(opts);
}

export interface RgMatch {
  file: string;
  line: number;
  text: string;
}

export interface RgContextLine {
  line: number;
  text: string;
  kind: "match" | "context";
}

export interface RgResult {
  file: string;
  matches: RgContextLine[];
}

export interface RgOptions {
  query: string;
  isRegex?: boolean;
  matchCase?: boolean;
  matchWholeWord?: boolean;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  contextLines?: number;
  maxResults?: number;
  cwd?: string;
  filePattern?: string; // limit search to files matching this glob
}

/**
 * Build the ripgrep argument array from options.
 */
export function buildRgArgs(opts: RgOptions): string[] {
  const args: string[] = [];

  // Always use JSON output for structured parsing
  args.push("--json");

  if (!opts.isRegex) {
    args.push("--fixed-strings");
  }

  if (opts.matchCase) {
    args.push("--case-sensitive");
  } else {
    args.push("--smart-case");
  }

  if (opts.matchWholeWord) {
    args.push("--word-regexp");
  }

  if (opts.contextLines && opts.contextLines > 0) {
    args.push("--context", String(opts.contextLines));
  }

  if (opts.maxResults) {
    args.push("--max-count", String(opts.maxResults));
  }

  for (const glob of opts.includeGlobs ?? []) {
    args.push("--glob", glob);
  }

  for (const glob of opts.excludeGlobs ?? []) {
    args.push("--glob", `!${glob}`);
  }

  // The query is always the last positional arg
  args.push(opts.query);

  // Always specify a search directory to prevent hanging on large trees
  // When no directory is given, ripgrep walks the entire cwd recursively
  // which can include node_modules and cause timeouts
  const searchDir = opts.filePattern
    ? "."
    : opts.cwd
      ? "."
      : ".";
  args.push(searchDir);

  return args;
}

/**
 * Run ripgrep with a 3-tier fallback chain.
 *
 * 1. Bundled ripgrep (@vscode/ripgrep) — fastest, auto-installed
 * 2. System ripgrep (`rg`) — fast, requires manual install
 * 3. Pure JavaScript fallback — slower, zero dependencies
 *
 * Returns structured results regardless of which tier succeeds.
 */
export async function runRg(opts: RgOptions): Promise<RgResult[]> {
  const args = buildRgArgs(opts);
  const cwd = opts.cwd;

  // Tier 1: Bundled ripgrep
  if (bundledRgPath) {
    const result = await tryBundledRg(bundledRgPath, args, cwd);
    if (result !== null) {
      return result;
    }
  }

  // Tier 2: System ripgrep
  const systemResult = await trySystemRg(args, cwd);
  if (systemResult !== null) {
    return systemResult;
  }

  // Tier 3: Pure JavaScript fallback
  return tryFallbackRg(opts);
}

/**
 * Get the current ripgrep backend status.
 * Useful for debugging which tier is being used.
 */
export function getRgStatus(): {
  bundled: string | null;
  system: boolean;
  fallback: boolean;
} {
  return {
    bundled: bundledRgPath ?? bundledRgError,
    system: false, // Unknown until tried
    fallback: true, // Always available
  };
}

/**
 * Parse ripgrep's NDJSON output into structured results.
 *
 * Each line is a JSON object. Match lines have "match" key,
 * context lines have "context" key.
 */
export function parseRgJson(ndjson: string): RgResult[] {
  const lines = ndjson.trimEnd().split("\n").filter(Boolean);
  const fileMap = new Map<string, RgContextLine[]>();

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // skip malformed lines
    }

    const obj = parsed as Record<string, unknown>;

    // Handle match events
    if (obj.type === "match") {
      const data = obj.data as {
        path?: { text?: string };
        lines?: { text?: string } | { line_number?: number; text?: string }[];
        line_number?: number;
      };
      const file = data.path?.text ?? "unknown";
      // ripgrep 15+: line_number at data level, lines is { text }
      // older: lines is [{ line_number, text }]
      let lineNumber: number | undefined;
      let text: string | undefined;

      if (Array.isArray(data.lines)) {
        // Old format: lines is array [{ line_number, text }]
        const first = data.lines[0];
        lineNumber = first?.line_number;
        text = first?.text;
      } else {
        // New format: line_number at data level, lines is { text }
        lineNumber = data.line_number;
        text = data.lines?.text;
      }

      if (lineNumber && text !== undefined) {
        const entries = fileMap.get(file) ?? [];
        entries.push({ line: lineNumber, text, kind: "match" });
        fileMap.set(file, entries);
      }
    }

    // Handle context events (from --context)
    if (obj.type === "context") {
      const data = obj.data as {
        path?: { text?: string };
        lines?: { text?: string } | { line_number?: number; text?: string }[];
        line_number?: number;
      };
      const file = data.path?.text ?? "unknown";
      let lineNumber: number | undefined;
      let text: string | undefined;

      if (Array.isArray(data.lines)) {
        const first = data.lines[0];
        lineNumber = first?.line_number;
        text = first?.text;
      } else {
        lineNumber = data.line_number;
        text = data.lines?.text;
      }

      if (lineNumber && text !== undefined) {
        const entries = fileMap.get(file) ?? [];
        entries.push({ line: lineNumber, text, kind: "context" });
        fileMap.set(file, entries);
      }
    }
  }

  // Sort matches by line number per file
  const results: RgResult[] = [];
  for (const [file, matches] of fileMap) {
    matches.sort((a, b) => a.line - b.line);
    results.push({ file, matches });
  }

  return results;
}

/**
 * Format RgResults into a token-efficient string for the LLM.
 *
 * Output format mirrors VS Code Search Editor:
 *
 *   src/auth.ts:
 *   42:   async function authenticateUser(req) {
 *   43:     const user = await validate(req);
 *
 *   src/routes.ts:
 *   15:   authenticateUser(req);
 */
export function formatResults(results: RgResult[]): string {
  if (results.length === 0) {
    return "No matches found.";
  }

  const parts: string[] = [];
  let totalMatches = 0;

  for (const result of results) {
    parts.push(`${result.file}:`);
    for (const m of result.matches) {
      if (m.kind === "match") totalMatches++;
      parts.push(`${m.line}: ${m.text}`);
    }
    parts.push(""); // blank line between files
  }

  const files = results.length;
  const suffix =
    files === 1
      ? `\n\n${totalMatches} match in 1 file.`
      : `\n\n${totalMatches} matches in ${files} files.`;

  return parts.join("\n") + suffix;
}
