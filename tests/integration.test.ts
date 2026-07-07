import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  writeFile,
  readFile,
  undoFile,
  redoFile,
  replaceLines,
  replaceInFile,
} from "../src/fileops.js";
import { findSymbolBoundary } from "../src/boundaries.js";
import { generateOutline } from "../src/outline.js";

describe("Integration - End-to-End Workflows", () => {
  let tempFilePath: string;

  beforeEach(() => {
    tempFilePath = path.join(
      os.tmpdir(),
      `test-integration-${Math.random().toString(36).slice(2)}.ts`,
    );
  });

  afterEach(() => {
    try {
      fs.unlinkSync(tempFilePath);
    } catch {
      // ignore
    }
  });

  it("runs a complete write -> replaceLines -> undo -> redo chain", () => {
    const initialCode = "Line 1\nLine 2\nLine 3";
    writeFile(tempFilePath, initialCode);

    // Replace line 2
    replaceLines({
      filePath: tempFilePath,
      startLine: 2,
      endLine: 2,
      newContent: "Line 2 Modded",
    });

    let content = readFile(tempFilePath);
    expect(content).toBe("Line 1\nLine 2 Modded\nLine 3");

    // Undo operation
    undoFile(tempFilePath);
    content = readFile(tempFilePath);
    expect(content).toBe(initialCode);

    // Redo operation
    redoFile(tempFilePath);
    content = readFile(tempFilePath);
    expect(content).toBe("Line 1\nLine 2 Modded\nLine 3");
  });

  it("executes: find boundary -> extract -> surgical replacement in-place", () => {
    const complexCode = [
      "class Database {", // 1
      "  connect() {", // 2
      '    console.log("Connecting...");', // 3
      "    return true;", // 4
      "  }", // 5
      "}", // 6
    ].join("\n");

    writeFile(tempFilePath, complexCode);

    // 1. Detect boundary for method starting at line 2
    const boundary = findSymbolBoundary(tempFilePath, 2);
    expect(boundary).not.toBeNull();
    expect(boundary!.startLine).toBe(2);
    expect(boundary!.endLine).toBe(5);

    // 2. Replace the entire method block
    const replacement = [
      "  async connect() {",
      "    await delay(100);",
      "    return this.client.connect();",
      "  }",
    ].join("\n");

    replaceLines({
      filePath: tempFilePath,
      startLine: boundary!.startLine,
      endLine: boundary!.endLine,
      newContent: replacement,
    });

    const finalContent = readFile(tempFilePath);
    const expected = [
      "class Database {",
      "  async connect() {",
      "    await delay(100);",
      "    return this.client.connect();",
      "  }",
      "}",
    ].join("\n");

    expect(finalContent).toBe(expected);
  });

  it("outline -> find symbol -> replace in symbol workflow", () => {
    const code = [
      "function oldName() {",
      "  return oldName;",
      "}",
      "",
      "function another() {",
      "  return oldName();",
      "}",
    ].join("\n");

    writeFile(tempFilePath, code);

    // 1. Get outline
    const outline = generateOutline(tempFilePath);
    expect(outline.length).toBeGreaterThanOrEqual(1);
    const names = outline.map((e) => e.name);
    expect(names).toContain("oldName");

    // 2. Replace all occurrences of oldName with newName
    const count = replaceInFile(tempFilePath, "oldName", "newName", false);
    expect(count).toBe(3);

    const updated = readFile(tempFilePath);
    expect(updated).not.toContain("oldName");
    expect(updated).toContain("newName");

    // 3. Undo the replacement
    undoFile(tempFilePath);
    const restored = readFile(tempFilePath);
    expect(restored).toBe(code);
  });

  it("multiple writes with interleaved undo/redo", () => {
    writeFile(tempFilePath, "v1");
    writeFile(tempFilePath, "v2");
    writeFile(tempFilePath, "v3");

    expect(readFile(tempFilePath)).toBe("v3");

    // Undo to v2
    undoFile(tempFilePath);
    expect(readFile(tempFilePath)).toBe("v2");

    // Redo to v3
    redoFile(tempFilePath);
    expect(readFile(tempFilePath)).toBe("v3");

    // Undo twice to v1
    undoFile(tempFilePath);
    undoFile(tempFilePath);
    expect(readFile(tempFilePath)).toBe("v1");

    // Third undo restores to empty (file was new, before="")
    undoFile(tempFilePath);
    expect(readFile(tempFilePath)).toBe("");

    // Now truly nothing to undo
    const result = undoFile(tempFilePath);
    expect(result).toBeNull();
  });

  it("new write clears redo stack", () => {
    writeFile(tempFilePath, "v1");
    writeFile(tempFilePath, "v2");

    undoFile(tempFilePath);
    expect(readFile(tempFilePath)).toBe("v1");

    // New write instead of redo
    writeFile(tempFilePath, "v3");

    // Redo should be gone
    const result = redoFile(tempFilePath);
    expect(result).toBeNull();
    expect(readFile(tempFilePath)).toBe("v3");
  });

  it("replaceInFile with regex across multi-line content", () => {
    const code = "const foo = 1;\nconst bar = 2;\nconst baz = 3;";
    writeFile(tempFilePath, code);

    const count = replaceInFile(
      tempFilePath,
      /const (\w+)/g,
      "let $1",
      true,
    );
    expect(count).toBe(3);

    const updated = readFile(tempFilePath);
    expect(updated).toBe("let foo = 1;\nlet bar = 2;\nlet baz = 3;");
  });
});
