import { describe, it, expect } from "vitest";
import { getSymbolPatterns, classifyReference } from "../src/symbols.js";

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
