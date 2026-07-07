/**
 * File I/O operations with undo/redo support.
 *
 * Every write to a file is tracked in a per-file edit stack,
 * enabling undo and redo operations.
 */

import { readFileSync, writeFileSync } from "node:fs";

/**
 * An edit entry in the undo/redo stack.
 */
export interface EditEntry {
  before: string; // file content before the edit
  after: string; // file content after the edit
  timestamp: number;
}

/**
 * Per-file edit stacks for undo/redo.
 * Keyed by absolute file path.
 */
const undoStack = new Map<string, EditEntry[]>();
const redoStack = new Map<string, EditEntry[]>();

/**
 * Read a file's content.
 * Returns null if the file does not exist.
 */
export function readFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Write content to a file, tracking the edit for undo/redo.
 */
export function writeFile(filePath: string, content: string): void {
  const before = readFile(filePath) ?? "";
  writeFileSync(filePath, content, "utf-8");

  const entry: EditEntry = {
    before,
    after: content,
    timestamp: Date.now(),
  };

  undoStack.set(filePath, [...(undoStack.get(filePath) ?? []), entry]);
  redoStack.delete(filePath); // clear redo stack on new edit
}

/**
 * Replace text in a file, tracking for undo.
 * Returns the number of replacements made.
 */
export function replaceInFile(
  filePath: string,
  pattern: string | RegExp,
  replacement: string,
  isRegex = true,
): number {
  const before = readFile(filePath);
  if (before === null) return -1;

  const regex = typeof pattern === "string"
    ? new RegExp(isRegex ? escapeRegex(pattern) : pattern, "g")
    : pattern;

  const after = before.replace(regex, replacement);
  const count = countReplacements(before, regex);

  if (count > 0) {
    writeFileSync(filePath, after, "utf-8");

    const entry: EditEntry = {
      before,
      after,
      timestamp: Date.now(),
    };

    undoStack.set(filePath, [...(undoStack.get(filePath) ?? []), entry]);
    redoStack.delete(filePath);
  }

  return count;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Count regex matches in the original content.
 */
function countReplacements(before: string, regex: RegExp): number {
  const matches = before.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Undo the last edit to a file.
 * Returns the restored content, or null if nothing to undo.
 */
export function undoFile(filePath: string): string | null {
  const stack = undoStack.get(filePath);
  if (!stack || stack.length === 0) return null;

  const entry = stack.pop()!;
  writeFileSync(filePath, entry.before, "utf-8");

  undoStack.set(filePath, stack);
  redoStack.set(filePath, [...(redoStack.get(filePath) ?? []), entry]);

  return entry.before;
}

/**
 * Redo an undone edit to a file.
 * Returns the redone content, or null if nothing to redo.
 */
export function redoFile(filePath: string): string | null {
  const stack = redoStack.get(filePath);
  if (!stack || stack.length === 0) return null;

  const entry = stack.pop()!;
  writeFileSync(filePath, entry.after, "utf-8");

  redoStack.set(filePath, stack);
  undoStack.set(filePath, [...(undoStack.get(filePath) ?? []), entry]);

  return entry.after;
}

/**
 * Get the number of available undo steps for a file.
 */
export function getUndoDepth(filePath: string): number {
  return undoStack.get(filePath)?.length ?? 0;
}

/**
 * Get the number of available redo steps for a file.
 */
export function getRedoDepth(filePath: string): number {
  return redoStack.get(filePath)?.length ?? 0;
}

/**
 * Replace lines in a file (1-indexed, inclusive range).
 */
export interface ReplaceLinesOptions {
  filePath: string;
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed, inclusive
  newContent: string;
}

export function replaceLines(opts: ReplaceLinesOptions): string {
  const content = readFile(opts.filePath);
  if (content === null) throw new Error(`File not found: ${opts.filePath}`);
  const lines = content.split("\n");

  const start = opts.startLine - 1;
  const end = opts.endLine;

  const newLines = [
    ...lines.slice(0, start),
    ...opts.newContent.split("\n"),
    ...lines.slice(end),
  ];

  const result = newLines.join("\n");
  writeFileSync(opts.filePath, result, "utf-8");

  const entry: EditEntry = {
    before: content,
    after: result,
    timestamp: Date.now(),
  };

  undoStack.set(opts.filePath, [...(undoStack.get(opts.filePath) ?? []), entry]);
  redoStack.delete(opts.filePath);

  return result;
}

/**
 * Insert content at a specific line (1-indexed).
 * Content is inserted *before* the given line.
 */
export interface InsertAtLineOptions {
  filePath: string;
  lineNumber: number; // 1-indexed, insert before this line
  content: string;
}

export function insertAtLine(opts: InsertAtLineOptions): string {
  const content = readFile(opts.filePath);
  if (content === null) throw new Error(`File not found: ${opts.filePath}`);
  const lines = content.split("\n");

  const idx = opts.lineNumber - 1;
  const insertLines = opts.content.split("\n");

  const newLines = [
    ...lines.slice(0, idx),
    ...insertLines,
    ...lines.slice(idx),
  ];

  const result = newLines.join("\n");
  writeFileSync(opts.filePath, result, "utf-8");

  const entry: EditEntry = {
    before: content,
    after: result,
    timestamp: Date.now(),
  };

  undoStack.set(opts.filePath, [...(undoStack.get(opts.filePath) ?? []), entry]);
  redoStack.delete(opts.filePath);

  return result;
}

/**
 * Move content from one location to another within a file.
 */
export interface MoveLinesOptions {
  filePath: string;
  fromStart: number; // 1-indexed
  fromEnd: number; // 1-indexed, inclusive
  toLine: number; // 1-indexed, insert before this line
}

export function moveLines(opts: MoveLinesOptions): string {
  const content = readFile(opts.filePath);
  if (content === null) throw new Error(`File not found: ${opts.filePath}`);
  const lines = content.split("\n");

  const fromStart = opts.fromStart - 1;
  const fromEnd = opts.fromEnd;
  const toIdx = opts.toLine - 1;

  // Extract the lines to move
  const moved = lines.slice(fromStart, fromEnd);
  const remaining = [
    ...lines.slice(0, fromStart),
    ...lines.slice(fromEnd),
  ];

  // Adjust toIdx if it's after the moved region
  let adjustedTo = toIdx;
  if (toIdx > fromStart) {
    adjustedTo = toIdx - (fromEnd - fromStart);
  }

  // Insert at target
  const newLines = [
    ...remaining.slice(0, adjustedTo),
    ...moved,
    ...remaining.slice(adjustedTo),
  ];

  const result = newLines.join("\n");
  writeFileSync(opts.filePath, result, "utf-8");

  const entry: EditEntry = {
    before: content,
    after: result,
    timestamp: Date.now(),
  };

  undoStack.set(opts.filePath, [...(undoStack.get(opts.filePath) ?? []), entry]);
  redoStack.delete(opts.filePath);

  return result;
}
