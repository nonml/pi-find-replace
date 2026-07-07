import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  replaceLines,
  insertAtLine,
  moveLines,
  writeFile,
  readFile,
  undoFile,
  redoFile,
} from "../src/fileops.js";

describe("fileops.ts - Line Operations Edge Cases", () => {
  let tempFilePath: string;

  beforeEach(() => {
    tempFilePath = path.join(
      os.tmpdir(),
      `test-fileops-${Math.random().toString(36).slice(2)}.txt`,
    );
  });

  afterEach(() => {
    try {
      fs.unlinkSync(tempFilePath);
    } catch {
      // ignore
    }
  });

  it("handles replaceLines when endLine is out of bounds", () => {
    const originalContent = "Line 1\nLine 2\nLine 3";
    fs.writeFileSync(tempFilePath, originalContent, "utf8");

    // endLine 100 on a 3-line file should clamp to end
    replaceLines({
      filePath: tempFilePath,
      startLine: 2,
      endLine: 100,
      newContent: "New Line 2\nNew Line 3",
    });

    const updated = fs.readFileSync(tempFilePath, "utf8");
    expect(updated).toBe("Line 1\nNew Line 2\nNew Line 3");
  });

  it("handles replaceLines with startLine beyond file length", () => {
    fs.writeFileSync(tempFilePath, "Line 1\nLine 2", "utf8");

    // startLine beyond file - should produce empty or minimal result
    replaceLines({
      filePath: tempFilePath,
      startLine: 10,
      endLine: 12,
      newContent: "Appended",
    });

    const updated = fs.readFileSync(tempFilePath, "utf8");
    expect(updated).toContain("Appended");
  });

  it("handles insertAtLine at beginning", () => {
    fs.writeFileSync(tempFilePath, "Line 1\nLine 2", "utf8");

    insertAtLine({ filePath: tempFilePath, lineNumber: 1, content: "Line 0" });
    const content = fs.readFileSync(tempFilePath, "utf8");
    expect(content).toBe("Line 0\nLine 1\nLine 2");
  });

  it("handles insertAtLine at middle", () => {
    fs.writeFileSync(tempFilePath, "Line 1\nLine 2", "utf8");

    insertAtLine({
      filePath: tempFilePath,
      lineNumber: 2,
      content: "Inserted Mid",
    });
    const content = fs.readFileSync(tempFilePath, "utf8");
    expect(content).toBe("Line 1\nInserted Mid\nLine 2");
  });

  it("handles insertAtLine beyond end of file", () => {
    fs.writeFileSync(tempFilePath, "Line 1\nLine 2", "utf8");

    insertAtLine({
      filePath: tempFilePath,
      lineNumber: 20,
      content: "Far End",
    });
    const content = fs.readFileSync(tempFilePath, "utf8");
    expect(content).toContain("Far End");
  });

  it("handles moveLines with normal forward move", () => {
    const originalContent = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
    fs.writeFileSync(tempFilePath, originalContent, "utf8");

    // Move lines 2-3 to before line 5
    moveLines({
      filePath: tempFilePath,
      fromStart: 2,
      fromEnd: 3,
      toLine: 5,
    });

    const updated = fs.readFileSync(tempFilePath, "utf8");
    expect(updated).toBe("Line 1\nLine 4\nLine 2\nLine 3\nLine 5");
  });

  it("handles moveLines with backward move", () => {
    const originalContent = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
    fs.writeFileSync(tempFilePath, originalContent, "utf8");

    // Move lines 4-5 to before line 2
    moveLines({
      filePath: tempFilePath,
      fromStart: 4,
      fromEnd: 5,
      toLine: 2,
    });

    const updated = fs.readFileSync(tempFilePath, "utf8");
    expect(updated).toBe("Line 1\nLine 4\nLine 5\nLine 2\nLine 3");
  });

  it("handles concurrent writes to the same file", () => {
    fs.writeFileSync(tempFilePath, "Initial", "utf8");

    // Multiple simultaneous writes (all sync, so last one wins)
    for (let i = 0; i < 10; i++) {
      writeFile(tempFilePath, `Writer ${i}`);
    }

    const finalContent = fs.readFileSync(tempFilePath, "utf8");
    expect(finalContent).toBe("Writer 9");
  });

  it("handles undo after multiple replaceLines", () => {
    fs.writeFileSync(tempFilePath, "A\nB\nC", "utf8");

    replaceLines({
      filePath: tempFilePath,
      startLine: 1,
      endLine: 1,
      newContent: "X",
    });
    replaceLines({
      filePath: tempFilePath,
      startLine: 2,
      endLine: 2,
      newContent: "Y",
    });

    expect(readFile(tempFilePath)).toBe("X\nY\nC");

    undoFile(tempFilePath);
    expect(readFile(tempFilePath)).toBe("X\nB\nC");

    undoFile(tempFilePath);
    expect(readFile(tempFilePath)).toBe("A\nB\nC");
  });

  it("throws on replaceLines for nonexistent file", () => {
    expect(() =>
      replaceLines({
        filePath: "/nonexistent/file.txt",
        startLine: 1,
        endLine: 1,
        newContent: "test",
      }),
    ).toThrow(/File not found/);
  });

  it("throws on insertAtLine for nonexistent file", () => {
    expect(() =>
      insertAtLine({
        filePath: "/nonexistent/file.txt",
        lineNumber: 1,
        content: "test",
      }),
    ).toThrow(/File not found/);
  });

  it("throws on moveLines for nonexistent file", () => {
    expect(() =>
      moveLines({
        filePath: "/nonexistent/file.txt",
        fromStart: 1,
        fromEnd: 1,
        toLine: 2,
      }),
    ).toThrow(/File not found/);
  });
});
