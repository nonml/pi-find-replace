import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { findSymbolBoundary, readLineRange } from "../src/boundaries.js";

describe("boundaries.ts - Symbol Boundary Edge Cases", () => {
  let tempFilePath: string;

  beforeEach(() => {
    tempFilePath = path.join(
      os.tmpdir(),
      `test-boundary-${Math.random().toString(36).slice(2)}.txt`,
    );
  });

  afterEach(() => {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  });

  it("handles deeply nested curly braces (5+ levels) with mixed matching brackets", () => {
    const code = [
      "function level1() {", // 1
      "  if (true) {", // 2
      "    while (true) {", // 3
      "      for (let i = 0; i < 1; i++) {", // 4
      "        try {", // 5
      // Mixed brackets to confuse parser
      "          let arr = [ { key: ( [ { nested: true } ] ) } ];", // 6
      "        } catch (e) {}", // 7
      "      }", // 8
      "    }", // 9
      "  }", // 10
      "}", // 11
    ].join("\n");

    fs.writeFileSync(tempFilePath, code, "utf8");

    const boundary = findSymbolBoundary(tempFilePath, 1);
    expect(boundary).not.toBeNull();
    expect(boundary!.startLine).toBe(1);
    expect(boundary!.endLine).toBe(11);
  });

  it("detects boundary for Python functions with decorators and nested classes", () => {
    const code = [
      "class Outer:", // 1
      "    @decorator1", // 2
      "    @decorator2(param=\"value\")", // 3
      "    class Inner:", // 4
      "        @nested_deco", // 5
      "        def method(self):", // 6
      '            print("Hello")', // 7
      "            ", // 8
      "        def sibling_method(self):", // 9
      "            pass", // 10
    ].join("\n");

    const pyPath = tempFilePath.replace(".txt", ".py");
    fs.writeFileSync(pyPath, code, "utf8");

    try {
      // Inner class at line 4 should span to end of file (sibling_method is part of Inner)
      const classBoundary = findSymbolBoundary(pyPath, 4);

      expect(classBoundary).not.toBeNull();
      expect(classBoundary!.startLine).toBe(4);
      expect(classBoundary!.endLine).toBeGreaterThanOrEqual(7);
    } finally {
      fs.unlinkSync(pyPath);
    }
  });

  it("safely handles blank-only files", () => {
    const blankCode = "\n\n   \n\n";
    fs.writeFileSync(tempFilePath, blankCode, "utf8");

    const boundary = findSymbolBoundary(tempFilePath, 1);
    expect(boundary).toBeNull();
  });

  it("safely handles comment-only files", () => {
    const commentCode = [
      "// Just comments",
      "/* Multiline",
      "   comment */",
      "# Python comment",
    ].join("\n");

    fs.writeFileSync(tempFilePath, commentCode, "utf8");

    const boundary = findSymbolBoundary(tempFilePath, 1);
    expect(boundary).toBeNull();
  });

  it("handles Python nested class with correct indent tracking", () => {
    const code = [
      "class Outer:", // 1
      "    pass", // 2
      "", // 3
      "class Sibling:", // 4
      "    pass", // 5
    ].join("\n");

    const pyPath = tempFilePath.replace(".txt", ".py");
    fs.writeFileSync(pyPath, code, "utf8");

    try {
      const boundary = findSymbolBoundary(pyPath, 1);
      expect(boundary).not.toBeNull();
      expect(boundary!.startLine).toBe(1);
      expect(boundary!.endLine).toBe(3); // Outer ends including trailing blank line
    } finally {
      fs.unlinkSync(pyPath);
    }
  });
});
