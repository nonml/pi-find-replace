import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { generateOutline, formatOutline } from "../src/outline.js";

describe("outline.ts - Outline Generation Edge Cases", () => {
  let tempFilePath: string;

  beforeEach(() => {
    tempFilePath = path.join(
      os.tmpdir(),
      `test-outline-${Math.random().toString(36).slice(2)}.txt`,
    );
  });

  afterEach(() => {
    try {
      fs.unlinkSync(tempFilePath);
    } catch {
      // ignore
    }
  });

  it("returns empty array for plain text with no symbols", () => {
    const text =
      "This is plain text.\nThere are no classes or functions here.\nJust lines of writing.";
    fs.writeFileSync(tempFilePath, text, "utf8");

    const outline = generateOutline(tempFilePath);
    expect(outline).toEqual([]);
  });

  it("processes deeply nested JS/TS classes (4+ levels)", () => {
    const code = [
      "class Level1 {",
      "  class Level2 {",
      "    class Level3 {",
      "      class Level4 {",
      "        deepMethod() {}",
      "      }",
      "    }",
      "  }",
      "}",
    ].join("\n");

    fs.writeFileSync(tempFilePath, code, "utf8");
    const outline = generateOutline(tempFilePath);

    const methodEntry = outline.find((e) => e.name === "deepMethod");
    expect(methodEntry).toBeDefined();
    expect(methodEntry!.indent).toBeGreaterThanOrEqual(3);
  });

  it("handles files with UTF-8 BOM", () => {
    const bomCode = "\uFEFFfunction hello() { return \"world\"; }";
    fs.writeFileSync(tempFilePath, bomCode, "utf8");

    const outline = generateOutline(tempFilePath);
    // BOM might interfere with first line detection
    // At minimum, it shouldn't crash
    expect(Array.isArray(outline)).toBe(true);
  });

  it("handles minified single-line code", () => {
    const minified =
      "function a(){class B{constructor(){this.c=1}d(){return 2}}}";
    fs.writeFileSync(tempFilePath, minified, "utf8");

    const outline = generateOutline(tempFilePath);
    expect(Array.isArray(outline)).toBe(true);
    // Should find at least function a
    const names = outline.map((e) => e.name);
    expect(names).toContain("a");
  });

  it("handles file with only whitespace", () => {
    fs.writeFileSync(tempFilePath, "   \n  \n    ", "utf8");
    const outline = generateOutline(tempFilePath);
    expect(outline).toEqual([]);
  });

  it("handles file with mixed languages", () => {
    const mixed = [
      "def python_func():",
      "    pass",
      "",
      "function jsFunc() {",
      "    return true;",
      "}",
    ].join("\n");
    fs.writeFileSync(tempFilePath, mixed, "utf8");
    const outline = generateOutline(tempFilePath);

    const names = outline.map((e) => e.name);
    // Should find at least jsFunc
    expect(names).toContain("jsFunc");
  });

  it("formatOutline handles empty entries", () => {
    const result = formatOutline([]);
    expect(result).toBe("No symbols found.");
  });

  it("formatOutline handles single entry", () => {
    const entries = [{ line: 1, name: "foo", kind: "function", indent: 0 }];
    const result = formatOutline(entries);
    expect(result).toContain("foo");
    expect(result).toContain("1 symbol");
  });

  it("formatOutline shows plural for multiple entries", () => {
    const entries = [
      { line: 1, name: "foo", kind: "function", indent: 0 },
      { line: 5, name: "bar", kind: "class", indent: 0 },
    ];
    const result = formatOutline(entries);
    expect(result).toContain("2 symbols");
  });
});
