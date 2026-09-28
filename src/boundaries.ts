/**
 * Boundary detection for symbols.
 *
 * Given a declaration line, find the start and end lines of the symbol.
 * Supports brace-based languages (JS, TS, Java, C, Go, Rust, etc.)
 * and indent-based languages (Python, Ruby).
 */

import { readFileSync } from "node:fs";

export interface SymbolBoundary {
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed, inclusive
  source: string; // full source of the symbol
}

/**
 * Language families for boundary detection.
 */
type BoundaryStrategy = "brace" | "indent" | "endKeyword";

/**
 * Map file extensions to boundary strategies.
 */
function getStrategy(filePath: string): BoundaryStrategy {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const indentExts = new Set(["py", "rb", "yaml", "yml"]);
  const endKeywordExts = new Set(["swift", "kt", "scala"]);

  if (indentExts.has(ext)) return "indent";
  if (endKeywordExts.has(ext)) return "endKeyword";
  return "brace";
}

/**
 * Find the boundaries of a symbol starting from its declaration line.
 */
export function findSymbolBoundary(
  filePath: string,
  startLine: number, // 1-indexed
): SymbolBoundary | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n");
  const zeroBased = startLine - 1;

  if (zeroBased < 0 || zeroBased >= lines.length) {
    return null;
  }

  const strategy = getStrategy(filePath);

  let endLine: number | null;
  switch (strategy) {
    case "brace":
      endLine = findBraceBoundary(lines, zeroBased);
      break;
    case "indent":
      endLine = findIndentBoundary(lines, zeroBased);
      break;
    case "endKeyword":
      endLine = findEndKeywordBoundary(lines, zeroBased);
      break;
    default:
      endLine = findBraceBoundary(lines, zeroBased);
  }

  if (endLine === null) return null;

  // Clamp to file length
  endLine = Math.min(endLine, lines.length - 1);

  const source = lines.slice(zeroBased, endLine + 1).join("\n");

  return {
    startLine: startLine,
    endLine: endLine + 1, // convert back to 1-indexed
    source,
  };
}

/**
 * Find boundary by matching braces { } ( ) [ ].
 * The block opener is the first `{` outside parentheses/brackets (so
 * destructured params like `f({ a }) {` are skipped); strings and comments
 * are ignored. A declaration that ends in `;` before any block opens
 * (e.g. `export const MAX = 10;`) ends on that line.
 */
function findBraceBoundary(lines: string[], startIdx: number): number | null {
  let quote: string | null = null; // ' " or `
  let inBlockComment = false;
  let parenDepth = 0; // ( and [ depth before the block opens
  let firstOther: string | null = null; // first ( or [ seen, fallback opener
  let braceDepth = 0;
  let opened = false;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (quote !== "`") quote = null; // only template literals span lines

    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (inBlockComment) {
        if (ch === "*" && line[j + 1] === "/") {
          inBlockComment = false;
          j++;
        }
        continue;
      }
      if (quote) {
        if (ch === "\\") j++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "/" && line[j + 1] === "/") break;
      if (ch === "/" && line[j + 1] === "*") {
        inBlockComment = true;
        j++;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        quote = ch;
        continue;
      }

      if (!opened) {
        if (ch === "(" || ch === "[") {
          if (firstOther === null) firstOther = ch;
          parenDepth++;
        } else if (ch === ")" || ch === "]") {
          parenDepth--;
        } else if (ch === "{" && parenDepth <= 0) {
          opened = true;
          braceDepth = 1;
        }
        continue;
      }

      if (ch === "{") braceDepth++;
      else if (ch === "}") {
        braceDepth--;
        if (braceDepth === 0) return i;
      }
    }

    // Brace-less declaration: statement ended before any block opened.
    if (!opened && parenDepth <= 0 && line.trim().endsWith(";")) {
      return i;
    }
  }

  if (!opened && firstOther) {
    return findBracketBoundary(lines, startIdx, firstOther);
  }
  return null; // no brace found / unmatched brace
}

/**
 * Fallback: match a ( or [ opener using the original line-based scan.
 */
function findBracketBoundary(
  lines: string[],
  startIdx: number,
  openChar: string,
): number | null {
  const closeChar = getCloseChar(openChar);
  let depth = 0;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === openChar) depth++;
      if (ch === closeChar) {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return null;
}

function getCloseChar(open: string): string {
  if (open === "{") return "}";
  if (open === "(") return ")";
  if (open === "[") return "]";
  return "}";
}

/**
 * Find boundary by indentation level.
 * Symbol ends when we hit a line at the same or lower indent level.
 */
function findIndentBoundary(lines: string[], startIdx: number): number | null {
  const startLine = lines[startIdx];
  const startIndent = getIndentLevel(startLine);

  // Find the first indented line after the declaration
  let bodyStart = startIdx + 1;
  while (bodyStart < lines.length) {
    const line = lines[bodyStart].trim();
    if (line === "" || line.startsWith("#")) {
      bodyStart++;
      continue;
    }
    break;
  }

  if (bodyStart >= lines.length) return startIdx;

  const bodyIndent = getIndentLevel(lines[bodyStart]);

  if (bodyIndent <= startIndent) return startIdx; // single-line or empty

  // Find where indent drops back to start level or below
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue; // skip blank lines

    if (getIndentLevel(line) <= startIndent) {
      return i - 1;
    }
  }

  return lines.length - 1; // extends to end of file
}

/**
 * Find boundary by end keywords (Swift, Kotlin, Scala).
 */
function findEndKeywordBoundary(lines: string[], startIdx: number): number | null {
  // For Swift/Kotlin/Scala, look for matching end/closing keywords
  const startLine = lines[startIdx].trim();

  // Check if this is a struct/class/func/if/for/while
  const blockKeywords = [
    "struct",
    "class",
    "func",
    "fun",
    "if",
    "for",
    "while",
    "switch",
    "enum",
    "extension",
    "protocol",
  ];

  const isBlock = blockKeywords.some((kw) => startLine.includes(kw));
  if (!isBlock) return startIdx;

  // Find opening brace
  let braceIdx = startIdx;
  while (braceIdx < lines.length) {
    if (lines[braceIdx].includes("{")) break;
    braceIdx++;
  }

  if (braceIdx >= lines.length) return startIdx;

  // Count braces (these languages use braces too). The opening brace on
  // braceIdx is counted by the loop itself, so start from 0.
  let depth = 0;
  for (let i = braceIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
  }

  return lines.length - 1;
}

function getIndentLevel(line: string): number {
  const match = line.match(/^[ \t]+/);
  if (!match) return 0;
  // Tabs advance to the next multiple of 8 (Python's rule).
  let width = 0;
  for (const ch of match[0]) width = ch === "\t" ? width + 8 - (width % 8) : width + 1;
  return width;
}

/**
 * Read a range of lines from a file.
 */
export interface LineRangeOptions {
  filePath: string;
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed, inclusive
}

export function readLineRange(opts: LineRangeOptions): string {
  const content = readFileSync(opts.filePath, "utf-8");
  const lines = content.split("\n");

  const start = Math.max(0, opts.startLine - 1);
  const end = Math.min(lines.length, opts.endLine);

  const slice = lines.slice(start, end);

  // Prepend line numbers
  return slice
    .map((line, i) => `${opts.startLine + i}: ${line}`)
    .join("\n");
}
