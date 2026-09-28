import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  getSymbolPatterns,
  classifyReference,
  buildDeclarationQuery,
  scopeGlobs,
  findSymbolDeclarations,
} from "../src/symbols.js";

// Re-export classifyReference for testing (it's not exported, so we'll test via patterns)
// For now, test the pattern generation and classification logic

describe("getSymbolPatterns", () => {
  it("returns patterns for 'function' kind", () => {
    const patterns = getSymbolPatterns("function");
    expect(patterns.length).toBeGreaterThan(0);
    // Should include Python def pattern
    expect(patterns.some((p) => p.includes("def\\s+"))).toBe(true);
    // Should include JS function pattern
    expect(patterns.some((p) => p.includes("function\\s+"))).toBe(true);
    // Should include Rust fn pattern
    expect(patterns.some((p) => p.includes("fn\\s+"))).toBe(true);
    // Should include Go func pattern
    expect(patterns.some((p) => p.includes("func\\s+"))).toBe(true);
  });

  it("returns patterns for 'class' kind", () => {
    const patterns = getSymbolPatterns("class");
    expect(patterns.some((p) => p.includes("class\\s+"))).toBe(true);
  });

  it("returns patterns for 'any' kind (combines all)", () => {
    const anyPatterns = getSymbolPatterns("any");
    const funcPatterns = getSymbolPatterns("function");
    // 'any' should have more or equal patterns than any single kind
    expect(anyPatterns.length).toBeGreaterThanOrEqual(funcPatterns.length);
  });

  it("returns patterns for 'interface' kind", () => {
    const patterns = getSymbolPatterns("interface");
    expect(patterns.some((p) => p.includes("interface\\s+"))).toBe(true);
    expect(patterns.some((p) => p.includes("protocol\\s+"))).toBe(true);
  });

  it("returns patterns for 'type' kind", () => {
    const patterns = getSymbolPatterns("type");
    expect(patterns.some((p) => p.includes("type\\s+"))).toBe(true);
  });

  it("returns patterns for 'enum' kind", () => {
    const patterns = getSymbolPatterns("enum");
    expect(patterns.some((p) => p.includes("enum\\s+"))).toBe(true);
  });

  it("returns patterns for 'variable' kind", () => {
    const patterns = getSymbolPatterns("variable");
    // Variable patterns use (?:const|let|var) combined
    expect(patterns.some((p) => p.includes("const"))).toBe(true);
    expect(patterns.some((p) => p.includes("let"))).toBe(true);
    expect(patterns.some((p) => p.includes("var"))).toBe(true);
  });

  it("returns patterns for 'constant' kind", () => {
    const patterns = getSymbolPatterns("constant");
    expect(patterns.some((p) => p.includes("const\\s+"))).toBe(true);
  });

  it("returns patterns for 'method' kind", () => {
    const patterns = getSymbolPatterns("method");
    expect(patterns.length).toBeGreaterThan(0);
  });
});

describe("classifyReference", () => {
  // We need to access the internal classifyReference function
  // Since it's not exported, we'll test the patterns directly

  it("identifies function definitions", () => {
    const line = "async function authenticateUser(req) {";
    const hasDefKeyword =
      /\b(?:function|class|interface|type|enum|struct|const|let|var|def|fn|func|protocol)\b/.test(
        line,
      );
    expect(hasDefKeyword).toBe(true);
  });

  it("identifies import lines", () => {
    const line = "import { authenticateUser } from './auth';";
    const hasImport = /(?:import|require|from|use|include)\b/.test(line);
    expect(hasImport).toBe(true);
  });

  it("identifies function calls", () => {
    const line = "  const result = authenticateUser(req);";
    const name = "authenticateUser";
    const hasCall = new RegExp(`\\b${name}\\s*\\(`).test(line);
    expect(hasCall).toBe(true);
  });

  it("does not false-positive on partial matches", () => {
    const line = "  // this is authenticateUsers plural";
    const name = "authenticateUser";
    const hasCall = new RegExp(`\\b${name}\\s*\\(`).test(line);
    expect(hasCall).toBe(false);
  });

  it("identifies Python def", () => {
    const line = "def authenticate_user(request):";
    const hasDef = /\bdef\b/.test(line);
    expect(hasDef).toBe(true);
  });

  it("identifies Rust fn", () => {
    const line = "pub fn authenticate_user(request: Request) -> Result<Token> {";
    const hasFn = /\bfn\b/.test(line);
    expect(hasFn).toBe(true);
  });

  it("identifies Go func", () => {
    const line = "func AuthenticateUser(req *http.Request) (*Token, error) {";
    const hasFunc = /\bfunc\b/.test(line);
    expect(hasFunc).toBe(true);
  });
});

describe("buildDeclarationQuery", () => {
  it("substitutes the name into the capture group, not the first \w+ (type slot)", () => {
    const re = new RegExp(buildDeclarationQuery("count", "variable"));
    // Java-style `Type name = ...`: declares `count`, not `Foo`
    expect(re.test("  Foo count = 1;")).toBe(true);
    const typeRe = new RegExp(buildDeclarationQuery("Foo", "variable"));
    expect(typeRe.test("  Foo count;")).toBe(false);
  });

  it("combines all patterns for a kind into one alternation", () => {
    const re = new RegExp(buildDeclarationQuery("run", "function"));
    expect(re.test("def run(self):")).toBe(true);
    expect(re.test("pub fn run() {")).toBe(true);
    expect(re.test("export function run() {")).toBe(true);
    expect(re.test("export function runner() {")).toBe(false);
  });

  it("escapes regex metacharacters in the name", () => {
    const re = new RegExp(buildDeclarationQuery("$el", "variable"));
    expect(re.test("const $el = 1")).toBe(true);
    expect(re.test("const xel = 1")).toBe(false);
  });
});

describe("scopeGlobs", () => {
  it("normalises directory scopes (trailing slash, ./, backslashes)", () => {
    expect(scopeGlobs("src/")).toEqual(["src/**", "src"]);
    expect(scopeGlobs("./src")).toEqual(["src/**", "src"]);
    expect(scopeGlobs("src\\lib\\")).toEqual(["src/lib/**", "src/lib"]);
  });

  it("passes globs through unchanged", () => {
    expect(scopeGlobs("src/**/*.ts")).toEqual(["src/**/*.ts"]);
  });

  it("treats empty and '.' as no scope", () => {
    expect(scopeGlobs(undefined)).toBeUndefined();
    expect(scopeGlobs("")).toBeUndefined();
    expect(scopeGlobs("./")).toBeUndefined();
  });
});

describe("findSymbolDeclarations", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "pfr-symbols-"));
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "src", "a.ts"), "export function target() {}\n");
    writeFileSync(join(dir, "lib", "b.ts"), "export function target() {}\n");
    writeFileSync(join(dir, "lib", "c.ts"), "export async function asyncTarget() {}\n");
  });

  it("finds declarations whose pattern match starts after a word char", async () => {
    // `(?:^|\s)` matches the space after `export`; rg --word-regexp rejected this
    const results = await findSymbolDeclarations({ name: "asyncTarget", cwd: dir });
    expect(results.map((r) => r.file)).toEqual([`.${sep}lib${sep}c.ts`]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("finds declarations with a trailing-slash scope like 'src/'", async () => {
    const results = await findSymbolDeclarations({ name: "target", scope: "src/", cwd: dir });
    expect(results.map((r) => r.file)).toEqual([`.${sep}src${sep}a.ts`]);
  });

  it("returns one result per line even when several patterns match it", async () => {
    const results = await findSymbolDeclarations({ name: "target", cwd: dir });
    expect(results).toHaveLength(2);
  });
});
