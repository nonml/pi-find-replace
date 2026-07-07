import { describe, it, expect } from "vitest";
import { findSymbolBoundary, readLineRange } from "../src/boundaries.js";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function createTempFile(name: string, content: string): string {
  const path = join(tmpdir(), `test-${name}`);
  writeFileSync(path, content, "utf-8");
  return path;
}

function cleanup(path: string) {
  try {
    rmSync(path);
  } catch {
    // ignore
  }
}

describe("findSymbolBoundary - brace-based", () => {
  it("finds simple function boundary", () => {
    const content = `function hello() {
  console.log("hi");
  return true;
}

function world() {
  return false;
}`;
    const path = createTempFile("simple.ts", content);
    try {
      const boundary = findSymbolBoundary(path, 1);
      expect(boundary).not.toBeNull();
      expect(boundary!.startLine).toBe(1);
      expect(boundary!.endLine).toBe(4);
      expect(boundary!.source).toContain("function hello");
    } finally {
      cleanup(path);
    }
  });

  it("finds nested braces correctly", () => {
    const content = `function outer() {
  if (true) {
    for (let i = 0; i < 10; i++) {
      console.log(i);
    }
  }
  return ok;
}`;
    const path = createTempFile("nested.ts", content);
    try {
      const boundary = findSymbolBoundary(path, 1);
      expect(boundary).not.toBeNull();
      expect(boundary!.endLine).toBe(8);
    } finally {
      cleanup(path);
    }
  });

  it("handles braces in strings", () => {
    const content = `function test() {
  const str = "hello { world }";
  return str;
}`;
    const path = createTempFile("strings.ts", content);
    try {
      const boundary = findSymbolBoundary(path, 1);
      expect(boundary).not.toBeNull();
      expect(boundary!.endLine).toBe(4);
    } finally {
      cleanup(path);
    }
  });

  it("handles class with methods", () => {
    const content = `class AuthService {
  constructor() {
    this.init();
  }

  login() {
    return true;
  }
}`;
    const path = createTempFile("class.ts", content);
    try {
      const boundary = findSymbolBoundary(path, 1);
      expect(boundary).not.toBeNull();
      expect(boundary!.startLine).toBe(1);
      expect(boundary!.endLine).toBe(9);
    } finally {
      cleanup(path);
    }
  });

  it("returns null for file not found", () => {
    const boundary = findSymbolBoundary("/nonexistent/file.ts", 1);
    expect(boundary).toBeNull();
  });

  it("returns null for out-of-range line", () => {
    const content = "hello";
    const path = createTempFile("small.ts", content);
    try {
      const boundary = findSymbolBoundary(path, 99);
      expect(boundary).toBeNull();
    } finally {
      cleanup(path);
    }
  });

  it("handles single-line function", () => {
    const content = `const fn = () => { return 42; };`;
    const path = createTempFile("single.ts", content);
    try {
      const boundary = findSymbolBoundary(path, 1);
      expect(boundary).not.toBeNull();
      expect(boundary!.startLine).toBe(1);
      expect(boundary!.endLine).toBe(1);
    } finally {
      cleanup(path);
    }
  });
});

describe("findSymbolBoundary - indent-based (Python)", () => {
  it("finds Python function boundary", () => {
    const content = `def hello():
    print("hi")
    return True

def world():
    return False`;
    const path = createTempFile("simple.py", content);
    try {
      const boundary = findSymbolBoundary(path, 1);
      expect(boundary).not.toBeNull();
      expect(boundary!.startLine).toBe(1);
      expect(boundary!.endLine).toBe(4); // includes blank line
    } finally {
      cleanup(path);
    }
  });

  it("finds Python class boundary", () => {
    const content = `class AuthService:
    def login(self):
        return True

    def logout(self):
        pass`;
    const path = createTempFile("class.py", content);
    try {
      const boundary = findSymbolBoundary(path, 1);
      expect(boundary).not.toBeNull();
      expect(boundary!.startLine).toBe(1);
      expect(boundary!.endLine).toBe(6);
    } finally {
      cleanup(path);
    }
  });
});

describe("readLineRange", () => {
  it("reads a range of lines", () => {
    const content = "line1\nline2\nline3\nline4\nline5";
    const path = createTempFile("lines.txt", content);
    try {
      const result = readLineRange({ filePath: path, startLine: 2, endLine: 4 });
      expect(result).toContain("line2");
      expect(result).toContain("line3");
      expect(result).toContain("line4");
    } finally {
      cleanup(path);
    }
  });
});
