/**
 * Ripgrep execution and JSON output parsing.
 *
 * All search tools route through here so we get consistent,
 * token-efficient output formatted for an LLM to consume.
 *
 * Uses a 3-tier fallback chain:
 * 1. Bundled ripgrep (@vscode/ripgrep) — auto-installed via npm
 * 2. System ripgrep (`rg`) — Pi-managed binary or `rg` on PATH
 * 3. Pure JavaScript fallback — zero dependencies, slower
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/** Max bytes of rg stdout we buffer before truncating the result set. */
const RG_MAX_BUFFER = 10 * 1024 * 1024;
/** Hard timeout for a single search, shared by every tier. */
export const SEARCH_TIMEOUT_MS = 30000;

// ---------------------------------------------------------------------------
// Bundled ripgrep (@vscode/ripgrep)
// ---------------------------------------------------------------------------

let bundledRgPath: string | null = null;
let bundledRgError: string | null = null;

try {
  // Dynamic import to avoid crashing if package is missing
  // (e.g. Pi sub-agent processes that don't carry our node_modules)
  const vscodeRg = await import("@vscode/ripgrep");
  if (vscodeRg?.rgPath && existsSync(vscodeRg.rgPath)) {
    bundledRgPath = vscodeRg.rgPath;
  } else {
    bundledRgError = "@vscode/ripgrep resolved but binary not found";
  }
} catch {
  bundledRgError = "@vscode/ripgrep not installed";
}

// ---------------------------------------------------------------------------
// System ripgrep
// ---------------------------------------------------------------------------

/**
 * Resolve the system ripgrep binary.
 *
 * Pi downloads its own `rg` into `<agentDir>/bin` but only adds that
 * directory to the main agent's PATH — sub-agent processes don't inherit
 * it, so a bare `rg` lookup fails there. Probe absolute locations first:
 *
 * 1. `PI_FIND_REPLACE_RG` — explicit override
 * 2. `<agentDir>/bin/rg[.exe]`, where agentDir is `PI_CODING_AGENT_DIR`
 *    or `~/.pi/agent` (same resolution as Pi's own `getBinDir()`)
 * 3. `rg` on PATH
 */
export function resolveSystemRgPath(): string {
  const override = process.env.PI_FIND_REPLACE_RG;
  if (override && existsSync(override)) return override;

  const binName = process.platform === "win32" ? "rg.exe" : "rg";
  const agentDir = process.env.PI_CODING_AGENT_DIR
    ? expandTilde(process.env.PI_CODING_AGENT_DIR)
    : join(homedir(), ".pi", "agent");
  const piManaged = join(agentDir, "bin", binName);
  if (existsSync(piManaged)) return piManaged;

  return "rg";
}

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  return p;
}

// ---------------------------------------------------------------------------
// Running a ripgrep binary
// ---------------------------------------------------------------------------

/**
 * Run a ripgrep binary with the given args.
 *
 * Returns parsed results, or `null` when the caller should try the next
 * tier (binary missing / not executable, or rg rejected the arguments —
 * e.g. look-around regexes, which only the JS fallback supports).
 *
 * Note: `execFile` reports the exit code on `err.code` (a number), not
 * `err.status` — that field only exists for the *Sync variants.
 */
export async function execRg(
  rgPath: string,
  args: string[],
  cwd: string | undefined,
): Promise<RgResult[] | null> {
  try {
    const result = await execFileAsync(rgPath, args, {
      cwd,
      maxBuffer: RG_MAX_BUFFER,
      timeout: SEARCH_TIMEOUT_MS,
      windowsHide: true,
    });
    return parseRgJson(result.stdout);
  } catch (err: unknown) {
    const error = err as {
      code?: number | string;
      killed?: boolean;
      signal?: string | null;
      stdout?: string;
    };
    const partial = parseRgJson(error.stdout ?? "");

    // 1 = ran fine, no matches
    if (error.code === 1) return [];

    // 2 = rg hit an error; matches may still have been printed
    // (e.g. permission denied on one file). No output → let the next tier try.
    if (error.code === 2) return partial.length > 0 ? partial : null;

    // Output exceeded maxBuffer: return what we got rather than falling
    // through to a slower tier that would produce the same huge result set.
    if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return partial;

    // Killed by our timeout: a slower tier won't do better on the same tree.
    if (error.killed) {
      if (partial.length > 0) return partial;
      throw new Error(
        `Search timed out after ${SEARCH_TIMEOUT_MS / 1000}s. Narrow it with a scope or include globs.`,
      );
    }

    // ENOENT / EACCES / anything else: binary unavailable, try next tier
    return null;
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

  if (opts.filePattern) {
    args.push("--glob", opts.filePattern);
  }

  for (const glob of opts.excludeGlobs ?? []) {
    args.push("--glob", `!${glob}`);
  }

  // `--` ends option parsing so a query starting with "-" isn't read as a flag
  args.push("--", opts.query);

  // Always pass an explicit path: with no path and a non-TTY stdin,
  // ripgrep searches stdin instead of the directory and hangs.
  args.push(".");

  return args;
}

/**
 * Run ripgrep with a 3-tier fallback chain.
 *
 * 1. Bundled ripgrep (@vscode/ripgrep) — fastest, auto-installed
 * 2. System ripgrep (`rg`) — Pi-managed binary or `rg` on PATH
 * 3. Pure JavaScript fallback — slower, zero dependencies
 *
 * Returns structured results regardless of which tier succeeds.
 */
export async function runRg(opts: RgOptions): Promise<RgResult[]> {
  const args = buildRgArgs(opts);
  const cwd = opts.cwd;

  // Tier 1: Bundled ripgrep
  if (bundledRgPath) {
    const result = await execRg(bundledRgPath, args, cwd);
    if (result !== null) {
      return result;
    }
  }

  // Tier 2: System ripgrep
  const systemRgPath = resolveSystemRgPath();
  if (systemRgPath !== bundledRgPath) {
    const systemResult = await execRg(systemRgPath, args, cwd);
    if (systemResult !== null) {
      return systemResult;
    }
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
  systemPath: string;
  fallback: boolean;
} {
  return {
    bundled: bundledRgPath ?? bundledRgError,
    system: false, // Unknown until tried
    systemPath: resolveSystemRgPath(), // "rg" means PATH lookup
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

    // Match events, plus context events (from --context)
    if (obj.type === "match" || obj.type === "context") {
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
        // rg includes the line terminator in `text`; drop it so output
        // doesn't get a blank line after every match
        entries.push({ line: lineNumber, text: text.replace(/\r?\n$/, ""), kind: obj.type });
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
