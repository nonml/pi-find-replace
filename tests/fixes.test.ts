import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { writeFile, readFile, undoFile, redoFile, getUndoDepth, replaceInFile } from "../src/fileops.js";
import { findSymbolBoundary } from "../src/boundaries.js";
import { generateOutline } from "../src/outline.js";

const made: string[] = [];
function tmp(ext: string, content: string | Buffer): string {
  const p = path.join(os.tmpdir(), `pfr-fix-${Math.random().toString(36).slice(2)}.${ext}`);
  fs.writeFileSync(p, content);
  made.push(p);
  return p;
}
afterEach(() => {
  for (const p of made.splice(0)) fs.rmSync(p, { force: true });
});

describe("fileops fixes", () => {
  it("undo refuses when file changed externally", () => {
    const p = tmp("txt", "a");
    writeFile(p, "b");
    fs.writeFileSync(p, "external");
    expect(() => undoFile(p)).toThrow(/modified outside/);
    expect(fs.readFileSync(p, "utf-8")).toBe("external");
  });

  it("redo refuses when file changed externally after undo", () => {
    const p = tmp("txt", "a");
    writeFile(p, "b");
    undoFile(p);
    fs.writeFileSync(p, "external");
    expect(() => redoFile(p)).toThrow(/modified outside/);
  });

  it("undo history keys are path-normalised", () => {
    const rel = path.relative(process.cwd(), tmp("txt", "a"));
    writeFile(rel, "b");
    expect(getUndoDepth(`./${rel}`)).toBe(1);
    expect(getUndoDepth(path.resolve(rel))).toBe(1);
  });

  it("undo history is capped at 50 per file", () => {
    const p = tmp("txt", "0");
    for (let i = 1; i <= 60; i++) writeFile(p, String(i));
    expect(getUndoDepth(p)).toBe(50);
  });

  it("refuses non-UTF-8 and binary files", () => {
    const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
    const latin1 = tmp("txt", bytes);
    expect(() => readFile(latin1)).toThrow(/non-UTF-8/);
    expect(() => writeFile(latin1, "x")).toThrow();
    expect(fs.readFileSync(latin1).equals(bytes)).toBe(true);
    const bin = tmp("bin", Buffer.from([0x61, 0x00, 0x62]));
    expect(() => readFile(bin)).toThrow(/binary/);
  });

  it("replaceInFile escapes only when isRegex is false", () => {
    const p = tmp("txt", "a.c abc");
    expect(replaceInFile(p, "a.c", "X", false)).toBe(1);
    expect(fs.readFileSync(p, "utf-8")).toBe("X abc");
    const q = tmp("txt", "a.c abc");
    expect(replaceInFile(q, "a.c", "X", true)).toBe(2);
  });
});

describe("boundaries fixes", () => {
  it("handles braces in destructured params", () => {
    const p = tmp("ts", "function f({ a, b }) {\n  return a;\n}\nconst z = 1;\n");
    expect(findSymbolBoundary(p, 1)?.endLine).toBe(3);
  });

  it("swift block ends at its closing brace", () => {
    const p = tmp("swift", "func f() {\n  x()\n}\nfunc g() {\n}\n");
    expect(findSymbolBoundary(p, 1)?.endLine).toBe(3);
  });

  it("kotlin fun is treated as a block", () => {
    const p = tmp("kt", "fun f() {\n  x()\n}\nval g = 1\n");
    expect(findSymbolBoundary(p, 1)?.endLine).toBe(3);
  });

  it("brace-less declaration does not swallow next block", () => {
    const p = tmp("ts", "export const MAX = 10;\nfunction g() {\n}\n");
    expect(findSymbolBoundary(p, 1)?.endLine).toBe(1);
  });

  it("python indentation handles tabs", () => {
    const p = tmp("py", "def f():\n\tx = 1\n\treturn x\ndef g():\n\tpass\n");
    expect(findSymbolBoundary(p, 1)?.endLine).toBe(3);
  });

  it("ignores braces in strings and comments", () => {
    const p = tmp("ts", 'function f() {\n  const s = "}";\n  // }\n  return s;\n}\n');
    expect(findSymbolBoundary(p, 1)?.endLine).toBe(5);
  });
});

describe("outline fixes", () => {
  it("does not list control-flow keywords as symbols", () => {
    const p = tmp("ts", "class A {\n  m() {\n    if (x) {\n    }\n    for (;;) {\n    }\n  }\n}\n");
    const names = generateOutline(p).map((e) => e.name);
    expect(names).not.toContain("if");
    expect(names).not.toContain("for");
  });
});
