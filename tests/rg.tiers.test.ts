import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRgArgs, execRg, parseRgJson, resolveSystemRgPath } from "../src/rg.js";

let dir: string;
let rgPath: string;

beforeAll(async () => {
  ({ rgPath } = await import("@vscode/ripgrep"));
  dir = mkdtempSync(join(tmpdir(), "pfr-tiers-"));
  writeFileSync(join(dir, "a.ts"), "const -flag = 1;\nfoobar\n");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("execRg", () => {
  it("returns [] (not null) when rg finds no matches", async () => {
    // rg exits 1 on no matches; this used to fall through every tier
    // into the JS fallback because the exit code was read from err.status
    const result = await execRg(rgPath, buildRgArgs({ query: "zzz_no_match_zzz" }), dir);
    expect(result).toEqual([]);
  });

  it("returns null when the binary doesn't exist", async () => {
    const result = await execRg(join(dir, "no-such-rg"), buildRgArgs({ query: "x" }), dir);
    expect(result).toBeNull();
  });

  it("returns null for regexes rg rejects so the JS fallback can try", async () => {
    const args = buildRgArgs({ query: "foo(?!bar)", isRegex: true });
    expect(await execRg(rgPath, args, dir)).toBeNull();
  });

  it("searches for queries that start with a dash", async () => {
    const result = await execRg(rgPath, buildRgArgs({ query: "-flag" }), dir);
    expect(result?.[0].matches[0].text).toBe("const -flag = 1;");
  });
});

describe("resolveSystemRgPath", () => {
  const saved = {
    agentDir: process.env.PI_CODING_AGENT_DIR,
    override: process.env.PI_FIND_REPLACE_RG,
  };
  const binName = process.platform === "win32" ? "rg.exe" : "rg";

  afterEach(() => {
    for (const [key, value] of [
      ["PI_CODING_AGENT_DIR", saved.agentDir],
      ["PI_FIND_REPLACE_RG", saved.override],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("prefers Pi's managed binary in <agentDir>/bin", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pfr-agent-"));
    try {
      mkdirSync(join(agentDir, "bin"));
      writeFileSync(join(agentDir, "bin", binName), "");
      delete process.env.PI_FIND_REPLACE_RG;
      process.env.PI_CODING_AGENT_DIR = agentDir;
      expect(resolveSystemRgPath()).toBe(join(agentDir, "bin", binName));
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("honours the PI_FIND_REPLACE_RG override", () => {
    delete process.env.PI_CODING_AGENT_DIR;
    process.env.PI_FIND_REPLACE_RG = rgPath;
    expect(resolveSystemRgPath()).toBe(rgPath);
  });

  it("falls back to PATH lookup when no managed binary exists", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pfr-agent-empty-"));
    try {
      delete process.env.PI_FIND_REPLACE_RG;
      process.env.PI_CODING_AGENT_DIR = agentDir;
      expect(resolveSystemRgPath()).toBe("rg");
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });
});

describe("buildRgArgs", () => {
  it("puts the query after -- so it's never parsed as a flag", () => {
    const args = buildRgArgs({ query: "-x" });
    expect(args.slice(-3)).toEqual(["--", "-x", "."]);
  });

  it("passes filePattern as a glob", () => {
    const args = buildRgArgs({ query: "x", filePattern: "*.ts" });
    expect(args[args.indexOf("*.ts") - 1]).toBe("--glob");
  });
});

describe("parseRgJson", () => {
  it("strips the line terminator rg includes in match text", () => {
    const raw = [
      '{"type":"match","data":{"path":{"text":"a.ts"},"lines":{"text":"foo\\n"},"line_number":1}}',
      '{"type":"context","data":{"path":{"text":"a.ts"},"lines":{"text":"bar\\r\\n"},"line_number":2}}',
    ].join("\n");
    expect(parseRgJson(raw)[0].matches.map((m) => m.text)).toEqual(["foo", "bar"]);
  });
});
