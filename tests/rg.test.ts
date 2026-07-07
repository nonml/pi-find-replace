import { describe, it, expect } from "vitest";
import { buildRgArgs, parseRgJson } from "../src/rg.js";

describe("buildRgArgs", () => {
  it("builds basic args with query", () => {
    const args = buildRgArgs({ query: "hello" });
    expect(args).toContain("--json");
    expect(args).toContain("--smart-case");
    expect(args).toContain("--fixed-strings");
    expect(args).toContain("hello");
    expect(args[args.length - 1]).toBe("."); // search directory appended
  });

  it("adds --case-sensitive when matchCase is true", () => {
    const args = buildRgArgs({ query: "hello", matchCase: true });
    expect(args).toContain("--case-sensitive");
    expect(args).not.toContain("--smart-case");
  });

  it("adds --word-regexp when matchWholeWord is true", () => {
    const args = buildRgArgs({ query: "hello", matchWholeWord: true });
    expect(args).toContain("--word-regexp");
  });

  it("omits --fixed-strings when isRegex is true", () => {
    const args = buildRgArgs({ query: "hello.*world", isRegex: true });
    expect(args).not.toContain("--fixed-strings");
  });

  it("adds context lines", () => {
    const args = buildRgArgs({ query: "hello", contextLines: 3 });
    expect(args).toContain("--context");
    const ctxIdx = args.indexOf("--context");
    expect(args[ctxIdx + 1]).toBe("3");
  });

  it("omits context when 0", () => {
    const args = buildRgArgs({ query: "hello", contextLines: 0 });
    expect(args).not.toContain("--context");
  });

  it("adds include globs", () => {
    const args = buildRgArgs({ query: "hello", includeGlobs: ["*.ts", "src/**"] });
    expect(args).toContain("--glob");
    expect(args).toContain("*.ts");
    expect(args).toContain("src/**");
  });

  it("adds exclude globs with ! prefix", () => {
    const args = buildRgArgs({ query: "hello", excludeGlobs: ["**/node_modules"] });
    expect(args).toContain("--glob");
    expect(args).toContain("!**/node_modules");
  });

  it("adds max-results", () => {
    const args = buildRgArgs({ query: "hello", maxResults: 10 });
    expect(args).toContain("--max-count");
    expect(args).toContain("10");
  });
});

describe("parseRgJson", () => {
  it("returns empty array for empty input", () => {
    expect(parseRgJson("")).toEqual([]);
    expect(parseRgJson("\n\n")).toEqual([]);
  });

  it("parses a single match (ripgrep 15+ format)", () => {
    const json = JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/test.ts" },
        lines: { text: "  const hello = world;" },
        line_number: 42,
      },
    });
    const results = parseRgJson(json);
    expect(results).toHaveLength(1);
    expect(results[0].file).toBe("src/test.ts");
    expect(results[0].matches).toHaveLength(1);
    expect(results[0].matches[0].line).toBe(42);
    expect(results[0].matches[0].kind).toBe("match");
  });

  it("parses a single match (old array format)", () => {
    const json = JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/test.ts" },
        lines: [{ line_number: 42, text: "  const hello = world;" }],
      },
    });
    const results = parseRgJson(json);
    expect(results).toHaveLength(1);
    expect(results[0].file).toBe("src/test.ts");
    expect(results[0].matches).toHaveLength(1);
    expect(results[0].matches[0].line).toBe(42);
    expect(results[0].matches[0].kind).toBe("match");
  });

  it("parses multiple matches in same file", () => {
    const match1 = JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/test.ts" },
        lines: { text: "hello" },
        line_number: 10,
      },
    });
    const match2 = JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/test.ts" },
        lines: { text: "hello again" },
        line_number: 20,
      },
    });
    const results = parseRgJson(`${match1}\n${match2}`);
    expect(results).toHaveLength(1);
    expect(results[0].matches).toHaveLength(2);
    expect(results[0].matches[0].line).toBe(10);
    expect(results[0].matches[1].line).toBe(20);
  });

  it("parses matches across multiple files", () => {
    const match1 = JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/a.ts" },
        lines: { text: "hello" },
        line_number: 1,
      },
    });
    const match2 = JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/b.ts" },
        lines: { text: "hello" },
        line_number: 5,
      },
    });
    const results = parseRgJson(`${match1}\n${match2}`);
    expect(results).toHaveLength(2);
  });

  it("parses context lines", () => {
    const ctx = JSON.stringify({
      type: "context",
      data: {
        path: { text: "src/test.ts" },
        lines: { text: "// before" },
        line_number: 41,
      },
    });
    const match = JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/test.ts" },
        lines: { text: "const hello = world;" },
        line_number: 42,
      },
    });
    const results = parseRgJson(`${ctx}\n${match}`);
    expect(results[0].matches).toHaveLength(2);
    expect(results[0].matches[0].kind).toBe("context");
    expect(results[0].matches[1].kind).toBe("match");
  });

  it("skips malformed JSON lines", () => {
    const match = JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/test.ts" },
        lines: { text: "hello" },
        line_number: 1,
      },
    });
    const results = parseRgJson(`${match}\nnot-json\nmore-garbage`);
    expect(results).toHaveLength(1);
  });

  it("sorts matches by line number", () => {
    const match2 = JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/test.ts" },
        lines: { text: "second" },
        line_number: 20,
      },
    });
    const match1 = JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/test.ts" },
        lines: { text: "first" },
        line_number: 10,
      },
    });
    const results = parseRgJson(`${match2}\n${match1}`);
    expect(results[0].matches[0].line).toBe(10);
    expect(results[0].matches[1].line).toBe(20);
  });

  it("handles missing path text", () => {
    const match = JSON.stringify({
      type: "match",
      data: {
        path: {},
        lines: { text: "hello" },
        line_number: 1,
      },
    });
    const results = parseRgJson(match);
    expect(results[0].file).toBe("unknown");
  });
});
