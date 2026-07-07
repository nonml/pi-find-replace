/**
 * Ripgrep execution and JSON output parsing.
 *
 * All search tools route through here so we get consistent,
 * token-efficient output formatted for an LLM to consume.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

  return args;
}

/**
 * Run ripgrep and parse NDJSON output into structured results.
 *
 * Ripgrep exits with code 1 when no matches are found.
 * We catch that and return an empty array instead of throwing.
 */
export async function runRg(opts: RgOptions): Promise<RgResult[]> {
  const args = buildRgArgs(opts);

  let stdout = "";
  let stderr = "";

  try {
    const result = await execFileAsync("rg", args, {
      cwd: opts.cwd,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err: unknown) {
    const error = err as { status?: number; stderr?: string };
    // Exit code 1 = no matches (normal for rg)
    if (error.status === 1) {
      return [];
    }
    // Exit code 2 = error, code 127 = rg not found
    const msg = error.stderr ?? String(err);
    if (error.status === 127) {
      throw new Error(
        "ripgrep (rg) is not installed. Install it via your package manager: " +
          "https://github.com/BurntSushi/ripgrep#installation",
      );
    }
    throw new Error(`ripgrep failed (exit ${error.status}): ${msg}`);
  }

  return parseRgJson(stdout);
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
        lines?: { line_number?: number; text?: string }[];
      };
      const file = data.path?.text ?? "unknown";
      const matchLine = data.lines?.[0];

      if (matchLine?.line_number && matchLine?.text !== undefined) {
        const entries = fileMap.get(file) ?? [];
        entries.push({
          line: matchLine.line_number,
          text: matchLine.text,
          kind: "match",
        });
        fileMap.set(file, entries);
      }
    }

    // Handle context events (from --context)
    if (obj.type === "context") {
      const data = obj.data as {
        path?: { text?: string };
        lines?: { line_number?: number; text?: string }[];
      };
      const file = data.path?.text ?? "unknown";
      const ctxLine = data.lines?.[0];

      if (ctxLine?.line_number && ctxLine?.text !== undefined) {
        const entries = fileMap.get(file) ?? [];
        entries.push({
          line: ctxLine.line_number,
          text: ctxLine.text,
          kind: "context",
        });
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
