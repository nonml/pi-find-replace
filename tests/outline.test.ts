import { describe, it, expect } from "vitest";
import { generateOutline, formatOutline } from "../src/outline.js";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function createTempFile(name: string, content: string): string {
  const path = join(tmpdir(), `test-outline-${name}`);
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

describe("generateOutline", () => {
  it("finds TypeScript class and methods", () => {
    const content = `export class AuthService {
  constructor() {}

  login(email: string): boolean {
    return true;
  }

  logout(): void {
    // logout
  }
}`;
    const path = createTempFile("auth.ts", content);
    try {
      const entries = generateOutline(path);
      expect(entries.length).toBeGreaterThan(0);
      const names = entries.map((s) => s.name);
      expect(names).toContain("AuthService");
      expect(names).toContain("login");
      expect(names).toContain("logout");
    } finally {
      cleanup(path);
    }
  });

  it("finds Python functions and classes", () => {
    const content = `class AuthService:
    def login(self, email):
        return True

    def logout(self):
        pass

def helper():
    return 42`;
    const path = createTempFile("auth.py", content);
    try {
      const entries = generateOutline(path);
      const names = entries.map((s) => s.name);
      expect(names).toContain("AuthService");
      expect(names).toContain("login");
      expect(names).toContain("logout");
      expect(names).toContain("helper");
    } finally {
      cleanup(path);
    }
  });

  it("finds Go functions", () => {
    const content = `package auth

func Login(email string) bool {
    return true
}

func Logout() {
}

type User struct {
    Name string
}`;
    const path = createTempFile("auth.go", content);
    try {
      const entries = generateOutline(path);
      const names = entries.map((s) => s.name);
      expect(names).toContain("Login");
      expect(names).toContain("Logout");
    } finally {
      cleanup(path);
    }
  });

  it("finds Rust functions and structs", () => {
    const content = `pub struct User {
    name: String,
}

pub fn authenticate(user: &User) -> bool {
    true
}

fn helper() {}`;
    const path = createTempFile("auth.rs", content);
    try {
      const entries = generateOutline(path);
      const names = entries.map((s) => s.name);
      expect(names).toContain("User");
      expect(names).toContain("authenticate");
      expect(names).toContain("helper");
    } finally {
      cleanup(path);
    }
  });

  it("returns empty array for empty file", () => {
    const path = createTempFile("empty.ts", "");
    try {
      const entries = generateOutline(path);
      expect(entries).toEqual([]);
    } finally {
      cleanup(path);
    }
  });

  it("returns empty array for plain text file", () => {
    const path = createTempFile("readme.txt", "just some text");
    try {
      const entries = generateOutline(path);
      expect(entries).toEqual([]);
    } finally {
      cleanup(path);
    }
  });

  it("returns empty array for nonexistent file", () => {
    const entries = generateOutline("/nonexistent/file.ts");
    expect(entries).toEqual([]);
  });

  it("handles arrow functions", () => {
    const content = `const greet = (name) => {
  console.log(name);
};

const add = (a, b) => a + b;`;
    const path = createTempFile("arrows.ts", content);
    try {
      const entries = generateOutline(path);
      const names = entries.map((s) => s.name);
      expect(names).toContain("greet");
      expect(names).toContain("add");
    } finally {
      cleanup(path);
    }
  });

  it("sorts symbols by line number", () => {
    const content = `function first() {}
function second() {}
function third() {}`;
    const path = createTempFile("order.ts", content);
    try {
      const entries = generateOutline(path);
      const lines = entries.map((s) => s.line);
      expect(lines).toEqual([...lines].sort((a, b) => a - b));
    } finally {
      cleanup(path);
    }
  });
});

describe("formatOutline", () => {
  it("formats outline as readable text", () => {
    const entries = [
      { name: "AuthService", line: 1, kind: "class", indent: 0 },
      { name: "login", line: 3, kind: "method", indent: 1 },
      { name: "logout", line: 7, kind: "method", indent: 1 },
    ];
    const formatted = formatOutline(entries);
    expect(formatted).toContain("AuthService");
    expect(formatted).toContain("login");
    expect(formatted).toContain("logout");
  });

  it("handles empty entries", () => {
    const formatted = formatOutline([]);
    expect(formatted).toContain("No symbols");
  });
});
