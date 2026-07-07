import { describe, it, expect } from "vitest";
import { buildRgArgs, parseRgJson } from "../src/rg.js";

describe("rg.ts - Ripgrep CLI Edge Cases", () => {
  describe("buildRgArgs", () => {
    it("uses --glob for include patterns", () => {
      const args = buildRgArgs({
        query: "const foo",
        includeGlobs: ["dir space/file $1 & emoji 🚀.ts"],
      });

      expect(args).toContain("--glob");
      const globIdx = args.indexOf("--glob");
      expect(args[globIdx + 1]).toContain("dir space");
    });

    it("builds correct args for regex query", () => {
      const args = buildRgArgs({
        query: "const (\\w+)",
        isRegex: true,
        matchCase: true,
        matchWholeWord: false,
      });

      expect(args).toContain("const (\\w+)");
      expect(args).toContain("--case-sensitive");
      expect(args).not.toContain("--fixed-strings");
    });

    it("adds context lines when requested", () => {
      const args = buildRgArgs({
        query: "test",
        contextLines: 3,
      });

      expect(args).toContain("--context");
      expect(args).toContain("3");
    });

    it("adds max-results when requested", () => {
      const args = buildRgArgs({
        query: "test",
        maxResults: 50,
      });

      expect(args).toContain("--max-count");
      expect(args).toContain("50");
    });

    it("adds word-regexp for whole word matching", () => {
      const args = buildRgArgs({
        query: "test",
        matchWholeWord: true,
      });

      expect(args).toContain("--word-regexp");
    });

    it("always includes --json flag", () => {
      const args = buildRgArgs({ query: "anything" });
      expect(args[0]).toBe("--json");
    });

    it("uses --fixed-strings for non-regex by default", () => {
      const args = buildRgArgs({ query: "anything" });
      expect(args).toContain("--fixed-strings");
    });

    it("uses --smart-case when matchCase is false/undefined", () => {
      const args = buildRgArgs({ query: "anything" });
      expect(args).toContain("--smart-case");
    });

    it("handles empty query", () => {
      const args = buildRgArgs({ query: "" });
      expect(args).toContain(""); // query is empty string
      expect(args[args.length - 1]).toBe("."); // directory appended
    });

    it("handles exclude globs with ! prefix", () => {
      const args = buildRgArgs({
        query: "test",
        excludeGlobs: ["node_modules", "dist"],
      });

      expect(args).toContain("--glob");
      expect(args).toContain("!node_modules");
      expect(args).toContain("!dist");
    });
  });

  describe("parseRgJson", () => {
    it("handles malformed and incomplete JSON lines", () => {
      const rawRipgrepOutput = [
        '{"type":"begin","data":{"path":{"text":"file.ts"}}}',
        "INVALID_JSON_HERE_!!!",
        '{"type":"match","data":{"path":{"text":"file.ts"},"lines":{"text":"const x = 1"},"line_number":10}}',
      ].join("\n");

      const results = parseRgJson(rawRipgrepOutput);
      expect(results.length).toBe(1);
      expect(results[0].file).toBe("file.ts");
      expect(results[0].matches.length).toBe(1);
      expect(results[0].matches[0].line).toBe(10);
      expect(results[0].matches[0].text).toBe("const x = 1");
    });

    it("handles empty input", () => {
      const results = parseRgJson("");
      expect(results).toEqual([]);
    });

    it("handles whitespace-only input", () => {
      const results = parseRgJson("   \n\n  ");
      expect(results).toEqual([]);
    });

    it("handles all-invalid JSON", () => {
      const raw = "not json\nalso not json\n{{{";
      const results = parseRgJson(raw);
      expect(results).toEqual([]);
    });

    it("handles multiple matches in same file", () => {
      const raw = [
        '{"type":"begin","data":{"path":{"text":"file.ts"}}}',
        '{"type":"match","data":{"path":{"text":"file.ts"},"lines":{"text":"const a = 1"},"line_number":1}}',
        '{"type":"match","data":{"path":{"text":"file.ts"},"lines":{"text":"const b = 2"},"line_number":5}}',
        '{"type":"match","data":{"path":{"text":"file.ts"},"lines":{"text":"const c = 3"},"line_number":10}}',
        '{"type":"end","data":{"path":{"text":"file.ts"}}}',
      ].join("\n");

      const results = parseRgJson(raw);
      expect(results.length).toBe(1);
      expect(results[0].matches.length).toBe(3);
      expect(results[0].matches[0].line).toBe(1);
      expect(results[0].matches[1].line).toBe(5);
      expect(results[0].matches[2].line).toBe(10);
    });

    it("handles matches across multiple files", () => {
      const raw = [
        '{"type":"begin","data":{"path":{"text":"a.ts"}}}',
        '{"type":"match","data":{"path":{"text":"a.ts"},"lines":{"text":"foo"},"line_number":1}}',
        '{"type":"end","data":{"path":{"text":"a.ts"}}}',
        '{"type":"begin","data":{"path":{"text":"b.ts"}}}',
        '{"type":"match","data":{"path":{"text":"b.ts"},"lines":{"text":"foo"},"line_number":3}}',
        '{"type":"end","data":{"path":{"text":"b.ts"}}}',
      ].join("\n");

      const results = parseRgJson(raw);
      expect(results.length).toBe(2);
      expect(results[0].file).toBe("a.ts");
      expect(results[1].file).toBe("b.ts");
    });

    it("handles context lines", () => {
      const raw = [
        '{"type":"begin","data":{"path":{"text":"file.ts"}}}',
        '{"type":"context","data":{"path":{"text":"file.ts"},"lines":{"text":"before"},"line_number":9}}',
        '{"type":"match","data":{"path":{"text":"file.ts"},"lines":{"text":"const x = 1"},"line_number":10}}',
        '{"type":"context","data":{"path":{"text":"file.ts"},"lines":{"text":"after"},"line_number":11}}',
      ].join("\n");

      const results = parseRgJson(raw);
      expect(results.length).toBe(1);
      expect(results[0].matches.length).toBe(3);
      expect(results[0].matches[1].line).toBe(10);
      expect(results[0].matches[1].kind).toBe("match");
    });

    it("handles very large output (1000 lines)", () => {
      const lines: string[] = [];
      for (let i = 1; i <= 1000; i++) {
        lines.push(
          `{"type":"match","data":{"path":{"text":"big.ts"},"lines":{"text":"line ${i}"},"line_number":${i}}}`,
        );
      }
      const raw = lines.join("\n");
      const results = parseRgJson(raw);
      expect(results.length).toBe(1);
      expect(results[0].matches.length).toBe(1000);
    });
  });
});
