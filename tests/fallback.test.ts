import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { searchFallback, FALLBACK_LIMITS } from "../src/fallback.js";
import { buildRgArgs, execRg, type RgOptions, type RgResult } from "../src/rg.js";

let root: string;

function write(rel: string, content: string | Buffer): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

/** rg-style display path for a fixture file */
function p(rel: string): string {
  return `.${sep}${rel.split("/").join(sep)}`;
}

function files(results: RgResult[]): string[] {
  return results.map((r) => r.file).sort();
}

function search(opts: Omit<RgOptions, "cwd">, cwd = root): Promise<RgResult[]> {
  return searchFallback({ ...opts, cwd });
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pfr-fallback-"));
  mkdirSync(join(root, ".git")); // make the fixture a repo root
  write(".gitignore", "generated/\n*.log\n!keep.log\nbuild/\nnode_modules/\n");
  write("src/a.ts", "export function needle() {}\n");
  write("src/b.ts", "const x = needle();\n");
  write("src/nested/.gitignore", "local.ts\n");
  write("src/nested/local.ts", "needle\n");
  write("src/nested/deep.ts", "needle\n");
  write("generated/gen.ts", "needle\n");
  write("debug.log", "needle\n");
  write("keep.log", "needle\n");
  // Heavy dirs from issue #1: hidden .dart_tool and non-hidden build
  write(".dart_tool/flutter_build/kernel.ts", "needle\n");
  write("build/app/out.ts", "needle\n");
  write("node_modules/pkg/index.ts", "needle\n");
  write(".hidden.ts", "needle\n");
  write("bin/blob.ts", Buffer.from("needle\0binary\n"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("searchFallback — tree filtering", () => {
  it("skips hidden entries, heavy dirs, gitignored and binary files", async () => {
    const results = await search({ query: "needle" });
    expect(files(results)).toEqual(
      [p("keep.log"), p("src/a.ts"), p("src/b.ts"), p("src/nested/deep.ts")].sort(),
    );
  });

  it("skips well-known heavy dirs even when nothing ignores them", async () => {
    const bare = mkdtempSync(join(tmpdir(), "pfr-bare-"));
    try {
      for (const d of ["build", "node_modules", "Pods", "__pycache__", "src"]) {
        mkdirSync(join(bare, d));
        writeFileSync(join(bare, d, "f.ts"), "needle\n");
      }
      const results = await search({ query: "needle" }, bare);
      expect(files(results)).toEqual([p("src/f.ts")]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("applies the enclosing repo's .gitignore when searching a subdirectory", async () => {
    write("src/generated/sub.ts", "needle\n");
    try {
      // `generated/` in the root .gitignore matches at any depth
      const results = await search({ query: "needle" }, join(root, "src"));
      expect(files(results)).toEqual([p("a.ts"), p("b.ts"), p("nested/deep.ts")].sort());
    } finally {
      rmSync(join(root, "src/generated"), { recursive: true, force: true });
    }
  });

  it("reports rg-style relative paths", async () => {
    const results = await search({ query: "export function" });
    expect(results).toHaveLength(1);
    expect(results[0].file).toBe(p("src/a.ts"));
  });

  it("matches include globs against relative paths (bare name = any depth)", async () => {
    const results = await search({ query: "needle", includeGlobs: ["*.ts"] });
    // Like rg, a matching include glob beats hidden/ignore rules for files,
    // but ignored/hidden directories (generated/, .dart_tool/) stay pruned
    expect(files(results)).toEqual(
      [
        p(".hidden.ts"),
        p("src/a.ts"),
        p("src/b.ts"),
        p("src/nested/deep.ts"),
        p("src/nested/local.ts"),
      ].sort(),
    );
  });

  it("supports scoped include globs", async () => {
    const results = await search({ query: "needle", includeGlobs: ["src/nested/**"] });
    expect(files(results)).toEqual([p("src/nested/deep.ts"), p("src/nested/local.ts")]);
  });

  it("prunes directories matched by exclude globs", async () => {
    const results = await search({ query: "needle", excludeGlobs: ["**/nested"] });
    expect(files(results)).toEqual([p("keep.log"), p("src/a.ts"), p("src/b.ts")].sort());
  });

  it("honours filePattern", async () => {
    const results = await search({ query: "needle", filePattern: "*.log" });
    expect(files(results)).toEqual([p("debug.log"), p("keep.log")]);
  });
});

describe("searchFallback — budgets", () => {
  const defaults = { ...FALLBACK_LIMITS };
  afterEach(() => Object.assign(FALLBACK_LIMITS, defaults));

  it("skips files over the size cap", async () => {
    FALLBACK_LIMITS.maxFileBytes = 10;
    const results = await search({ query: "needle" });
    // "export function needle() {}\n" is over 10 bytes; the others aren't
    expect(files(results)).not.toContain(p("src/a.ts"));
    expect(files(results)).toContain(p("src/nested/deep.ts"));
  });

  it("stops after maxFiles files", async () => {
    FALLBACK_LIMITS.maxFiles = 1;
    const results = await search({ query: "needle" });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("stops walking after maxEntries directory entries", async () => {
    FALLBACK_LIMITS.maxEntries = 2;
    const results = await search({ query: "needle" });
    expect(results).toEqual([]);
  });
});

describe("searchFallback — matching", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "pfr-match-"));
    writeFileSync(join(dir, "m.ts"), "Foo foo\r\n$price = 1\r\nfoobar\r\nfoo\r\n");
    writeFileSync(join(dir, "ctx.ts"), "a\nhit1\nhit2\nb\nc\n");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("uses smart case like rg", async () => {
    const lower = await search({ query: "foo" }, dir);
    expect(lower[0].matches.map((m) => m.line)).toEqual([1, 3, 4]);
    const upper = await search({ query: "Foo" }, dir);
    expect(upper[0].matches.map((m) => m.line)).toEqual([1]);
  });

  it("strips CR from CRLF lines", async () => {
    const results = await search({ query: "foobar" }, dir);
    expect(results[0].matches[0].text).toBe("foobar");
  });

  it("whole-word works for queries that start with a non-word char", async () => {
    const results = await search({ query: "$price", matchWholeWord: true }, dir);
    expect(results[0].matches.map((m) => m.line)).toEqual([2]);
  });

  it("whole-word excludes partial matches", async () => {
    const results = await search({ query: "foo", matchWholeWord: true, matchCase: true }, dir);
    expect(results[0].matches.map((m) => m.line)).toEqual([1, 4]);
  });

  it("supports look-around (which rg's default engine rejects)", async () => {
    const results = await search({ query: "foo(?!bar)", isRegex: true, matchCase: true }, dir);
    expect(results[0].matches.map((m) => m.line)).toEqual([1, 4]);
  });

  it("does not duplicate lines when context windows overlap", async () => {
    const results = await search({ query: "hit", contextLines: 1 }, dir);
    expect(results[0].matches).toEqual([
      { line: 1, text: "a", kind: "context" },
      { line: 2, text: "hit1", kind: "match" },
      { line: 3, text: "hit2", kind: "match" },
      { line: 4, text: "b", kind: "context" },
    ]);
  });

  it("throws a clear error for an invalid regex", async () => {
    await expect(search({ query: "(unclosed", isRegex: true }, dir)).rejects.toThrow(
      /Invalid regex/,
    );
  });
});

describe("fallback parity with ripgrep", async () => {
  const { rgPath } = await import("@vscode/ripgrep");

  const cases: [string, Omit<RgOptions, "cwd">][] = [
    ["plain", { query: "needle" }],
    ["include glob", { query: "needle", includeGlobs: ["*.ts"] }],
    ["scoped glob", { query: "needle", includeGlobs: ["src/**"] }],
    ["exclude glob", { query: "needle", excludeGlobs: ["**/nested"] }],
    ["context", { query: "needle", contextLines: 1 }],
    ["whole word regex", { query: "need\\w+", isRegex: true, matchWholeWord: true }],
  ];

  for (const [name, opts] of cases) {
    it(`matches rg output: ${name}`, async () => {
      const rg = await execRg(rgPath, buildRgArgs({ ...opts, cwd: root }), root);
      const js = await search(opts);
      const sortByFile = (r: RgResult[]) => [...r].sort((a, b) => a.file.localeCompare(b.file));
      expect(sortByFile(js)).toEqual(sortByFile(rg ?? []));
    });
  }
});
