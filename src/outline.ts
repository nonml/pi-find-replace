/**
 * File outline generation.
 *
 * Produces a quick structure map of a file showing all
 * top-level and nested symbols with their line numbers.
 */

import { readFileSync } from "node:fs";
import { getSymbolPatterns } from "./symbols.js";

export interface OutlineEntry {
  line: number; // 1-indexed
  name: string;
  kind: string;
  indent: number; // nesting level
}

/** Control-flow keywords that method-like patterns can mistake for names. */
const CONTROL_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "catch", "return",
  "throw", "new", "typeof", "await", "yield", "elif", "except", "with",
]);

/**
 * Generate an outline of a file.
 */
export function generateOutline(filePath: string): OutlineEntry[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.split("\n");
  const patterns = getSymbolPatterns("any");
  const entries: OutlineEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let name = "";

    // Try each pattern individually
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        name = match[1];
        break;
      }
    }

    if (!name || CONTROL_KEYWORDS.has(name)) continue;

    // Detect kind from keywords
    const kind = detectKind(line);

    // Calculate indent level
    const indent = calculateIndent(line, entries);

    entries.push({
      line: i + 1,
      name,
      kind,
      indent,
    });
  }

  return entries;
}

/**
 * Detect the kind of symbol from the declaration line.
 */
function detectKind(line: string): string {
  const trimmed = line.trim();

  if (/\bfunction\b/.test(trimmed) || /\bfn\b/.test(trimmed) || /\bdef\b/.test(trimmed) || /\bfunc\b/.test(trimmed)) {
    return "function";
  }
  if (/\bclass\b/.test(trimmed)) {
    return "class";
  }
  if (/\binterface\b/.test(trimmed) || /\bprotocol\b/.test(trimmed)) {
    return "interface";
  }
  if (/\btype\b/.test(trimmed) && !/\btypeof\b/.test(trimmed)) {
    return "type";
  }
  if (/\benum\b/.test(trimmed)) {
    return "enum";
  }
  if (/\bconst\b/.test(trimmed)) {
    return "constant";
  }
  if (/\b(let|var)\b/.test(trimmed)) {
    return "variable";
  }
  if (/\b(struct|impl)\b/.test(trimmed)) {
    return "struct";
  }

  // Check if it looks like a method (inside a class)
  if (/\w+\s*\(.*\)\s*[:{]/.test(trimmed)) {
    return "method";
  }

  return "symbol";
}

/**
 * Calculate indent level based on whitespace and parent entries.
 */
function calculateIndent(line: string, _entries: OutlineEntry[]): number {
  const match = line.match(/^( +)/);
  const spaces = match ? match[1].length : 0;

  // Convert spaces to indent levels (assume 2-space indent)
  return Math.floor(spaces / 2);
}

/**
 * Format outline entries into a readable string.
 */
export function formatOutline(entries: OutlineEntry[]): string {
  if (entries.length === 0) {
    return "No symbols found.";
  }

  const parts: string[] = [];
  parts.push(`${entries.length} symbol${entries.length !== 1 ? "s" : ""} found:`);
  parts.push("");

  for (const entry of entries) {
    const prefix = "  ".repeat(entry.indent);
    const kindLabel = entry.kind.toUpperCase().padEnd(10);
    parts.push(`${prefix}${entry.line}. ${kindLabel} ${entry.name}`);
  }

  return parts.join("\n");
}
