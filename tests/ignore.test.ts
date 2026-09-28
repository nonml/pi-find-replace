import { describe, it, expect } from "vitest";
import { compileGlob, matchRules, parseIgnoreFile } from "../src/ignore.js";

function matches(pattern: string, path: string, isDir = false): boolean | undefined {
  const rule = compileGlob(pattern);
  if (!rule) return undefined;
  return matchRules([rule], path, isDir);
}

describe("compileGlob", () => {
  it("matches a bare name at any depth", () => {
    expect(matches("build", "build", true)).toBe(true);
    expect(matches("build", "packages/app/build", true)).toBe(true);
    expect(matches("*.log", "a/b/c.log")).toBe(true);
    expect(matches("*.log", "c.log.txt")).toBeUndefined();
  });

  it("anchors patterns containing a slash", () => {
    expect(matches("/build", "build", true)).toBe(true);
    expect(matches("/build", "app/build", true)).toBeUndefined();
    expect(matches("src/*.ts", "src/a.ts")).toBe(true);
    expect(matches("src/*.ts", "lib/src/a.ts")).toBeUndefined();
  });

  it("does not let * cross directories", () => {
    expect(matches("src/*.ts", "src/deep/a.ts")).toBeUndefined();
  });

  it("supports ** in leading, middle and trailing position", () => {
    expect(matches("**/node_modules", "a/b/node_modules", true)).toBe(true);
    expect(matches("src/**/*.ts", "src/a.ts")).toBe(true);
    expect(matches("src/**/*.ts", "src/x/y/a.ts")).toBe(true);
    expect(matches("src/**", "src/x/a.ts")).toBe(true);
    expect(matches("src/**", "srcx/a.ts")).toBeUndefined();
  });

  it("restricts trailing-slash patterns to directories", () => {
    expect(matches("out/", "out", true)).toBe(true);
    expect(matches("out/", "out", false)).toBeUndefined();
  });

  it("supports ? and character classes", () => {
    expect(matches("file?.txt", "file1.txt")).toBe(true);
    expect(matches("file[0-9].txt", "file7.txt")).toBe(true);
    expect(matches("file[!0-9].txt", "file7.txt")).toBeUndefined();
    expect(matches("file[!0-9].txt", "filex.txt")).toBe(true);
  });

  it("escapes regex metacharacters", () => {
    expect(matches("a+b.(c)", "a+b.(c)")).toBe(true);
    expect(matches("a+b.(c)", "aab.(c)")).toBeUndefined();
  });

  it("returns null for patterns that can't match", () => {
    expect(compileGlob("")).toBeNull();
    expect(compileGlob("!")).toBeNull();
    expect(compileGlob("/")).toBeNull();
  });
});

describe("parseIgnoreFile", () => {
  it("skips comments and blank lines, handles negation (last match wins)", () => {
    const rules = parseIgnoreFile("# comment\n\n*.log\n!keep.log\r\n");
    expect(rules).toHaveLength(2);
    expect(matchRules(rules, "debug.log", false)).toBe(true);
    expect(matchRules(rules, "keep.log", false)).toBe(false);
    expect(matchRules(rules, "main.ts", false)).toBeUndefined();
  });

  it("treats escaped # and ! as literals", () => {
    const rules = parseIgnoreFile("\\#notes\n\\!important");
    expect(matchRules(rules, "#notes", false)).toBe(true);
    expect(matchRules(rules, "!important", false)).toBe(true);
  });

  it("ignores trailing whitespace", () => {
    const rules = parseIgnoreFile("build/   ");
    expect(matchRules(rules, "build", true)).toBe(true);
  });
});
