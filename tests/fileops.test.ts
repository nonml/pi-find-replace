import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  writeFile,
  readFile,
  replaceInFile,
  undoFile,
  redoFile,
  getUndoDepth,
  getRedoDepth,
} from "../src/fileops.js";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let testPath: string;

beforeEach(() => {
  // Clear all stacks for clean tests
  const stacks = (globalThis as any).__undoStacks;
  if (stacks) stacks.clear();
  const redoStacks = (globalThis as any).__redoStacks;
  if (redoStacks) redoStacks.clear();
});

function createTempFile(content: string): string {
  testPath = join(tmpdir(), `test-fileops-${Date.now()}.txt`);
  writeFileSync(testPath, content, "utf-8");
  return testPath;
}

function cleanup() {
  try {
    rmSync(testPath);
  } catch {
    // ignore
  }
}

describe("writeFile / readFile", () => {
  afterEach(cleanup);

  it("writes and reads content", () => {
    const content = "hello world";
    const path = createTempFile(content);
    const read = readFile(path);
    expect(read).toBe(content);
  });

  it("returns null for nonexistent file", () => {
    const read = readFile("/nonexistent/file.txt");
    expect(read).toBeNull();
  });

  it("pushes to undo stack on write", () => {
    const path = createTempFile("original");
    writeFile(path, "modified");
    expect(getUndoDepth(path)).toBe(1);
  });

  it("clears redo stack on write", () => {
    const path = createTempFile("original");
    writeFile(path, "modified");
    undoFile(path);
    expect(getRedoDepth(path)).toBe(1);
    writeFile(path, "modified again");
    expect(getRedoDepth(path)).toBe(0);
  });
});

describe("replaceInFile", () => {
  afterEach(cleanup);

  it("replaces string literally", () => {
    const path = createTempFile("hello world");
    const count = replaceInFile(path, "world", "there", false);
    expect(count).toBe(1);
    expect(readFile(path)).toBe("hello there");
  });

  it("replaces with regex", () => {
    const path = createTempFile("hello world hello");
    const count = replaceInFile(path, "hello", "hi", true);
    expect(count).toBe(2);
    expect(readFile(path)).toBe("hi world hi");
  });

  it("returns -1 for nonexistent file", () => {
    const count = replaceInFile("/nonexistent.txt", "a", "b", false);
    expect(count).toBe(-1);
  });

  it("returns 0 when pattern not found", () => {
    const path = createTempFile("hello");
    const count = replaceInFile(path, "notfound", "x", false);
    expect(count).toBe(0);
  });

  it("pushes to undo stack", () => {
    const path = createTempFile("hello world");
    replaceInFile(path, "world", "there", false);
    expect(getUndoDepth(path)).toBe(1);
  });

  it("reports replacement count", () => {
    const path = createTempFile("foo bar foo bar");
    const count = replaceInFile(path, "foo", "baz", false);
    expect(count).toBe(2);
  });
});

describe("undoFile / redoFile", () => {
  afterEach(cleanup);

  it("undoes last write", () => {
    const path = createTempFile("original");
    writeFile(path, "modified");
    const result = undoFile(path);
    expect(result).toBe("original");
    expect(readFile(path)).toBe("original");
  });

  it("undoes multiple steps", () => {
    const path = createTempFile("v1");
    writeFile(path, "v2");
    writeFile(path, "v3");
    expect(getUndoDepth(path)).toBe(2);
    undoFile(path);
    expect(readFile(path)).toBe("v2");
    undoFile(path);
    expect(readFile(path)).toBe("v1");
  });

  it("returns null when nothing to undo", () => {
    const path = createTempFile("original");
    const result = undoFile(path);
    expect(result).toBeNull();
  });

  it("redo after undo", () => {
    const path = createTempFile("original");
    writeFile(path, "modified");
    undoFile(path);
    expect(readFile(path)).toBe("original");
    const result = redoFile(path);
    expect(result).toBe("modified");
    expect(readFile(path)).toBe("modified");
  });

  it("redo clears on new write", () => {
    const path = createTempFile("v1");
    writeFile(path, "v2");
    undoFile(path);
    writeFile(path, "v3");
    const result = redoFile(path);
    expect(result).toBeNull();
  });

  it("undoes replaceInFile", () => {
    const path = createTempFile("hello world");
    replaceInFile(path, "world", "there", false);
    expect(readFile(path)).toBe("hello there");
    undoFile(path);
    expect(readFile(path)).toBe("hello world");
  });

  it("handles empty file", () => {
    const path = createTempFile("");
    writeFile(path, "content");
    undoFile(path);
    expect(readFile(path)).toBe("");
  });

  it("handles file with newlines", () => {
    const path = createTempFile("line1\nline2\nline3");
    writeFile(path, "modified");
    undoFile(path);
    expect(readFile(path)).toBe("line1\nline2\nline3");
  });
});

describe("getUndoDepth / getRedoDepth", () => {
  afterEach(cleanup);

  it("returns 0 for new file", () => {
    const path = createTempFile("hello");
    expect(getUndoDepth(path)).toBe(0);
    expect(getRedoDepth(path)).toBe(0);
  });

  it("returns 0 for nonexistent file", () => {
    expect(getUndoDepth("/nonexistent.txt")).toBe(0);
    expect(getRedoDepth("/nonexistent.txt")).toBe(0);
  });

  it("increments on each write", () => {
    const path = createTempFile("v1");
    writeFile(path, "v2");
    expect(getUndoDepth(path)).toBe(1);
    writeFile(path, "v3");
    expect(getUndoDepth(path)).toBe(2);
  });
});
