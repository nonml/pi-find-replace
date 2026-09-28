import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const decls: { file: string; line: number; text: string }[] = [];
vi.mock("../src/symbols.js", () => ({
  findSymbolDeclarations: vi.fn(async (o: { name: string }) =>
    decls.filter((d) => d.text.includes(o.name)),
  ),
  findSymbolReferences: vi.fn(async () => []),
  getSymbolPatterns: vi.fn(() => []),
}));
vi.mock("../src/rg.js", () => ({ runRg: vi.fn(), formatResults: vi.fn() }));

import register from "../src/index.js";

type Tool = { name: string; execute: (...a: unknown[]) => Promise<any> };
const tools = new Map<string, Tool>();
register({ registerTool: (t: Tool) => tools.set(t.name, t) } as any);
const run = async (name: string, params: object): Promise<string> =>
  (await tools.get(name)!.execute("id", params, undefined, undefined, undefined))
    .content[0].text;

let dir: string;
let cwd: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pfr-tools-"));
  cwd = process.cwd();
  process.chdir(dir);
  decls.length = 0;
});
afterEach(() => {
  process.chdir(cwd);
  fs.rmSync(dir, { recursive: true, force: true });
});
const w = (f: string, c: string) => fs.writeFileSync(path.join(dir, f), c);
const r = (f: string) => fs.readFileSync(path.join(dir, f), "utf-8");

describe("find_replace", () => {
  it("expands $1, $&, $$ like String.prototype.replace", async () => {
    w("a.txt", "foo-bar");
    await run("find_replace", { regexQuery: "(\\w+)-(\\w+)", replaceString: "$2_$1 [$&] $$", files: ["a.txt"] });
    expect(r("a.txt")).toBe("bar_foo [foo-bar] $");
  });

  it("$1 works with preserveCase", async () => {
    w("a.txt", "Foo1");
    await run("find_replace", { regexQuery: "foo(\\d)", replaceString: "bar$1", files: ["a.txt"], preserveCase: true });
    expect(r("a.txt")).toBe("Bar1");
  });

  it("preserveCase maps ALL-CAPS to ALL-CAPS", async () => {
    w("a.txt", "FOO foo Foo");
    await run("find_replace", { regexQuery: "foo", replaceString: "bar", files: ["a.txt"], preserveCase: true });
    expect(r("a.txt")).toBe("BAR bar Bar");
  });

  it("multiline lets . match newlines", async () => {
    w("a.txt", "a\nb");
    await run("find_replace", { regexQuery: "a.b", replaceString: "x", files: ["a.txt"], multiline: true });
    expect(r("a.txt")).toBe("x");
  });

  it("expands globs and reports skipped entries", async () => {
    w("a.ts", "foo");
    const out = await run("find_replace", { regexQuery: "foo", replaceString: "bar", files: ["*.ts", "missing.ts", "*.none"] });
    expect(r("a.ts")).toBe("bar");
    expect(out).toContain("missing.ts: File not found");
    expect(out).toContain("*.none: No files match glob");
  });

  it("does not descend into node_modules unless the glob names it", async () => {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(dir, "node_modules/pkg"), { recursive: true });
    w("src/a.ts", "foo");
    w("node_modules/pkg/b.ts", "foo");
    await run("find_replace", { regexQuery: "foo", replaceString: "bar", files: ["**/*.ts"] });
    expect(r("src/a.ts")).toBe("bar");
    expect(r("node_modules/pkg/b.ts")).toBe("foo");
    await run("find_replace", { regexQuery: "foo", replaceString: "bar", files: ["node_modules/**/*.ts"] });
    expect(r("node_modules/pkg/b.ts")).toBe("bar");
  });
});

describe("replace_in_symbol", () => {
  it("matches ./-prefixed search paths and keeps $ literal", async () => {
    w("a.ts", "function f() {\n  return x;\n}\n");
    decls.push({ file: "./a.ts", line: 1, text: "function f() {" });
    await run("replace_in_symbol", { file: "a.ts", symbol: "f", find: "x", replace: "$&$1" });
    expect(r("a.ts")).toBe("function f() {\n  return $&$1;\n}\n");
  });
});

describe("move_symbol", () => {
  it("removes the symbol from the source file on cross-file moves", async () => {
    w("a.ts", "function f() {\n  return 1;\n}\nconst y = 2;\n");
    w("b.ts", "const z = 3;");
    decls.push({ file: "./a.ts", line: 1, text: "function f() {" });
    await run("move_symbol", { symbol: "f", from: "a.ts", to: "b.ts" });
    expect(r("a.ts")).toBe("const y = 2;\n");
    expect(r("b.ts")).toContain("function f()");
  });

  it("same-file move after an anchor removes the original", async () => {
    w("a.ts", "function f() {\n}\nfunction g() {\n}");
    decls.push({ file: "./a.ts", line: 1, text: "function f() {" });
    decls.push({ file: "./a.ts", line: 3, text: "function g() {" });
    await run("move_symbol", { symbol: "f", from: "a.ts", to: "a.ts", position: "after:g" });
    expect(r("a.ts")).toBe("function g() {\n}\nfunction f() {\n}\n");
  });

  it("errors when after: anchor is not found", async () => {
    w("a.ts", "function f() {\n}\n");
    w("b.ts", "x");
    decls.push({ file: "a.ts", line: 1, text: "function f() {" });
    const out = await run("move_symbol", { symbol: "f", from: "a.ts", to: "b.ts", position: "after:nope" });
    expect(out).toContain("not found");
    expect(r("b.ts")).toBe("x");
    expect(r("a.ts")).toBe("function f() {\n}\n");
  });
});
