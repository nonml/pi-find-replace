/**
 * Language-agnostic symbol detection.
 *
 * Uses ripgrep with regex patterns to find symbol declarations
 * across any language. No parsers, no grammars — just fast regex.
 */

import { runRg, type RgOptions } from "./rg.js";

/**
 * Symbol kinds the user can search for.
 */
export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "variable"
  | "constant"
  | "enum"
  | "any";

/**
 * Regex patterns for detecting symbol declarations per language family.
 * Each pattern captures the symbol name in group 1.
 */
interface PatternSet {
  patterns: string[];
  extensions: string[];
}

/**
 * All symbol kinds except 'any'.
 */
const CONCRETE_KINDS: Exclude<SymbolKind, "any">[] = [
  "function",
  "class",
  "method",
  "interface",
  "type",
  "variable",
  "constant",
  "enum",
];

/**
 * Patterns keyed by concrete symbol kind.
 */
const KIND_PATTERNS: Record<Exclude<SymbolKind, "any">, PatternSet[]> = {
  function: [
    {
      patterns: [
        `(?:^|\\s)(?:export\\s+|async\\s+|static\\s+|public\\s+|private\\s+|protected\\s+|const\\s+|let\\s+)?function\\s+(\\w+)`,
        `(?:^|\\s)(?:export\\s+)?(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:async\\s+)?(?:\\([^)]*\\)|[^=])\\s*=>`,
        `(?:^|\\s)func\\s+(\\w+)`,
        `(?:^|\\s)(?:pub\\s+)?fn\\s+(\\w+)`,
        `(?:^|\\s)(?:public|private|protected|static)?\\s*function\\s+(\\w+)`,
      ],
      extensions: [
        "*.ts", "*.tsx", "*.js", "*.jsx", "*.java", "*.c", "*.h", "*.cpp",
        "*.hpp", "*.cs", "*.go", "*.rs", "*.php",
      ],
    },
    { patterns: [`(?:^|\\s)def\\s+(\\w+)`], extensions: ["*.py"] },
    { patterns: [`(?:^|\\s)def\\s+(?:self\\.)?(\\w+)`], extensions: ["*.rb"] },
    {
      patterns: [`(?:^|\\s)(?:public|private|internal|static)?\\s*func\\s+(\\w+)`],
      extensions: ["*.swift"],
    },
    {
      patterns: [`(?:^|\\s)(?:public|private|internal|protected|static)?\\s*fun\\s+(\\w+)`],
      extensions: ["*.kt", "*.kts"],
    },
  ],
  class: [
    {
      patterns: [
        `(?:^|\\s)(?:export\\s+)?class\\s+(\\w+)`,
        `(?:^|\\s)(?:export\\s+)?(?:abstract\\s+)?class\\s+(\\w+)`,
      ],
      extensions: [
        "*.ts", "*.tsx", "*.js", "*.jsx", "*.java", "*.cs", "*.cpp", "*.hpp", "*.php", "*.rs",
      ],
    },
    { patterns: [`(?:^|\\s)class\\s+(\\w+)`], extensions: ["*.py", "*.rb"] },
    { patterns: [`(?:^|\\s)type\\s+(\\w+)\\s+struct`], extensions: ["*.go"] },
    {
      patterns: [`(?:^|\\s)(?:public|private|internal)?\\s*class\\s+(\\w+)`],
      extensions: ["*.swift"],
    },
  ],
  method: [
    {
      patterns: [
        `(?:^|\\s)(?:async\\s+)?(\\w+)\\s*\\([^)]*\\)\\s*(:\\s*\\w+)?\\s*\\{`,
        `(?:^|\\s)(?:public|private|protected|static|async|virtual|override)?\\s+\\w+\\s+(\\w+)\\s*\\(`,
        `(?:->|::)(\\w+)\\s*\\(`,
      ],
      extensions: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.java", "*.cs", "*.php", "*.rs"],
    },
    { patterns: [`(?:^|\\s)\\s+def\\s+(\\w+)`], extensions: ["*.py"] },
    { patterns: [`(?:^|\\s)\\s+def\\s+(?:self\\.)?(\\w+)`], extensions: ["*.rb"] },
  ],
  interface: [
    { patterns: [`(?:^|\\s)(?:export\\s+)?interface\\s+(\\w+)`], extensions: ["*.ts", "*.tsx"] },
    {
      patterns: [`(?:^|\\s)(?:public|private)?\\s*interface\\s+(\\w+)`],
      extensions: ["*.java", "*.cs", "*.go"],
    },
    { patterns: [`(?:^|\\s)protocol\\s+(\\w+)`], extensions: ["*.swift"] },
  ],
  type: [
    {
      patterns: [
        `(?:^|\\s)(?:export\\s+)?type\\s+(\\w+)`,
        `(?:^|\\s)(?:export\\s+)?type\\s+(\\w+)\\s*=`,
      ],
      extensions: ["*.ts", "*.tsx", "*.js", "*.jsx"],
    },
    { patterns: [`(?:^|\\s)type\\s+(\\w+)\\s+(struct|interface|enum)`], extensions: ["*.go"] },
    { patterns: [`(?:^|\\s)(?:pub\\s+)?struct\\s+(\\w+)`], extensions: ["*.rs"] },
    { patterns: [`(?:^|\\s)(?:export\\s+)?typedef\\s+.*\\s+(\\w+)`], extensions: ["*.c", "*.h", "*.cpp", "*.hpp"] },
  ],
  enum: [
    {
      patterns: [`(?:^|\\s)(?:export\\s+)?enum\\s+(\\w+)`],
      extensions: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.java", "*.cs", "*.go", "*.rs", "*.php"],
    },
  ],
  variable: [
    {
      patterns: [
        `(?:^|\\s)(?:export\\s+)?(?:const|let|var)\\s+(\\w+)`,
        `(?:^|\\s)(?:public|private|protected)?\\s*(?:static)?\\s*\\w+\\s+(\\w+)\\s*[=;]`,
      ],
      extensions: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.java", "*.cs", "*.php", "*.rs"],
    },
    {
      patterns: [`(?:^|\\s)(?:export\\s+)?(\\w+)\\s*=`, `(?:^|\\s)(\\w+)\\s*=\\s*[^=]`],
      extensions: ["*.py"],
    },
    { patterns: [`(?:^|\\s)(?:var|let|const)\\s+(\\w+)`], extensions: ["*.swift", "*.kt"] },
  ],
  constant: [
    {
      patterns: [`(?:^|\\s)(?:export\\s+)?const\\s+(\\w+)`],
      extensions: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.java", "*.cs", "*.php"],
    },
    { patterns: [`(?:^|\\s)(?:pub\\s+)?const\\s+(\\w+)`], extensions: ["*.rs"] },
    { patterns: [`(?:^|\\s)const\\s+(\\w+)`], extensions: ["*.go", "*.py", "*.rb", "*.swift"] },
  ],
};

/**
 * Get the combined regex patterns for a symbol kind.
 */
export function getSymbolPatterns(kind: SymbolKind): string[] {
  if (kind === "any") {
    const all: string[] = [];
    for (const k of CONCRETE_KINDS) {
      for (const set of KIND_PATTERNS[k]) {
        all.push(...set.patterns);
      }
    }
    return all;
  }
  const patterns: string[] = [];
  const concreteKind = kind as Exclude<SymbolKind, "any">;
  for (const set of KIND_PATTERNS[concreteKind]) {
    patterns.push(...set.patterns);
  }
  return patterns;
}

/**
 * Find symbol declarations by name using ripgrep.
 */
export interface FindSymbolOptions {
  name: string;
  kind?: SymbolKind;
  scope?: string;
  cwd?: string;
  contextLines?: number;
}

export interface SymbolResult {
  file: string;
  line: number;
  text: string;
  kind: string;
}

/**
 * Find symbol declarations matching the given name.
 */
export async function findSymbolDeclarations(opts: FindSymbolOptions): Promise<SymbolResult[]> {
  const results: SymbolResult[] = [];

  const rgOpts: RgOptions = {
    query: buildDeclarationQuery(opts.name, opts.kind ?? "any"),
    isRegex: true,
    matchCase: false,
    matchWholeWord: false, // see buildDeclarationQuery
    includeGlobs: scopeGlobs(opts.scope),
    excludeGlobs: ["**/node_modules", "**/.git", "**/dist", "**/build"],
    cwd: opts.cwd,
  };

  // One search for all patterns: each extra search is a full tree walk
  const rgResults = await runRg(rgOpts);

  for (const result of rgResults) {
    for (const match of result.matches) {
      results.push({
        file: result.file,
        line: match.line,
        text: match.text,
        kind: opts.kind ?? "any",
      });
    }
  }

  results.sort((a, b) => {
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    return a.line - b.line;
  });

  return results;
}

/**
 * Find all references to a symbol (calls, imports, uses).
 */
export interface FindReferencesOptions {
  name: string;
  scope?: string;
  cwd?: string;
  excludeFiles?: string[];
}

export interface ReferenceResult {
  file: string;
  line: number;
  text: string;
  kind: "definition" | "call" | "import" | "reference";
}

function classifyReference(text: string, name: string): ReferenceResult["kind"] {
  const trimmed = text.trim();

  if (
    /\b(?:function|class|interface|type|enum|struct|const|let|var|def|fn|func|protocol)\b/.test(
      trimmed,
    ) && trimmed.includes(name)
  ) {
    return "definition";
  }

  if (/(?:import|require|from|use|include)\b/.test(trimmed) && trimmed.includes(name)) {
    return "import";
  }

  if (new RegExp(`\\b${escapeRegex(name)}\\s*\\(`).test(trimmed)) {
    return "call";
  }

  return "reference";
}

export async function findSymbolReferences(opts: FindReferencesOptions): Promise<ReferenceResult[]> {
  const defs = await findSymbolDeclarations({
    name: opts.name,
    kind: "any",
    scope: opts.scope,
    cwd: opts.cwd,
  });

  const defSet = new Set(defs.map((d) => `${d.file}:${d.line}`));

  const rgOpts: RgOptions = {
    query: opts.name,
    isRegex: false,
    matchCase: false,
    matchWholeWord: true,
    includeGlobs: scopeGlobs(opts.scope),
    excludeGlobs: [
      "**/node_modules", "**/.git", "**/dist", "**/build",
      ...(opts.excludeFiles ?? []),
    ],
    cwd: opts.cwd,
  };

  const rgResults = await runRg(rgOpts);
  const results: ReferenceResult[] = [];

  for (const result of rgResults) {
    for (const match of result.matches) {
      const key = `${result.file}:${match.line}`;
      if (defSet.has(key)) continue;

      results.push({
        file: result.file,
        line: match.line,
        text: match.text,
        kind: classifyReference(match.text, opts.name),
      });
    }
  }

  results.sort((a, b) => {
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    return a.line - b.line;
  });

  return results;
}

/**
 * Combine every declaration pattern for `kind` into one alternation,
 * with the name-capturing `(\w+)` group replaced by the exact name.
 * (Replacing the first bare `\w+` instead would hit type slots such as
 * `\w+\s+(\w+)` in method/variable patterns.)
 */
export function buildDeclarationQuery(name: string, kind: SymbolKind): string {
  // The patterns' own prefixes (`\s+`, `::`, ...) bound the name's start;
  // `\b` bounds its end so `run` doesn't match `runner`. Word-regexp mode
  // can't be used instead: patterns begin with `(?:^|\s)`, so in
  // `export async function f` the match starts right after a word char.
  const exactName = /\w$/.test(name)
    ? `(?:${escapeRegex(name)})\\b`
    : `(?:${escapeRegex(name)})`;
  return getSymbolPatterns(kind)
    .map((pattern) => `(?:${pattern.replace("(\\w+)", exactName)})`)
    .join("|");
}

/**
 * Turn a user-supplied scope into include globs. Accepts a directory
 * ("src", "src/", "./src"), a file, or a glob ("src/**\/*.ts").
 */
export function scopeGlobs(scope: string | undefined): string[] | undefined {
  if (!scope) return undefined;
  const s = scope.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (s === "" || s === ".") return undefined;
  if (/[*?[]/.test(s)) return [s];
  // Directory contents, or the path itself when it is a file
  return [`${s}/**`, s];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
