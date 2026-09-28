/**
 * Minimal gitignore-style pattern matching for the JS fallback scanner.
 *
 * Covers what ripgrep honours by default so the fallback walks the same
 * files the native tiers do: nested `.gitignore` / `.ignore` files, last
 * match wins, `!` negation, trailing `/` for directories only, and a `/`
 * anywhere but the end anchoring the pattern to the file's directory.
 * The same syntax is used for include/exclude globs (ripgrep's `--glob`).
 */

export interface IgnoreRule {
  regex: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

// Windows filesystems are case-insensitive, and so is git there by default
const CASE_FLAG = process.platform === "win32" ? "i" : "";

/**
 * Compile one gitignore-style pattern. Returns null for patterns that
 * can never match (e.g. empty after stripping `!` and `/`).
 */
export function compileGlob(pattern: string): IgnoreRule | null {
  let p = pattern;
  let negate = false;

  if (p.startsWith("!")) {
    negate = true;
    p = p.slice(1);
  } else if (p.startsWith("\\!") || p.startsWith("\\#")) {
    p = p.slice(1);
  }

  let dirOnly = false;
  if (p.endsWith("/")) {
    dirOnly = true;
    p = p.slice(0, -1);
  }

  if (p === "") return null;

  if (p.includes("/")) {
    // Anchored to the directory holding the rule
    if (p.startsWith("/")) p = p.slice(1);
  } else {
    // No slash: matches a name at any depth
    p = `**/${p}`;
  }

  return { regex: new RegExp(`^${globBody(p)}$`, CASE_FLAG), negate, dirOnly };
}

/** Translate a glob into a regex body matched against a `/`-separated path. */
function globBody(p: string): string {
  let re = "";
  let i = 0;

  while (i < p.length) {
    const ch = p[i];

    if (p.startsWith("**/", i) && (i === 0 || p[i - 1] === "/")) {
      // Leading or middle `**/`: zero or more directories
      re += "(?:.*/)?";
      i += 3;
    } else if (p.startsWith("/**", i) && i + 3 === p.length) {
      // Trailing `/**`: everything inside
      re += "/.*";
      i += 3;
    } else if (p.startsWith("**", i)) {
      re += ".*";
      i += 2;
    } else if (ch === "*") {
      re += "[^/]*";
      i++;
    } else if (ch === "?") {
      re += "[^/]";
      i++;
    } else if (ch === "[") {
      // A `]` right after `[` or `[!` is a literal member of the class
      let j = i + 1;
      if (p[j] === "!" || p[j] === "^") j++;
      if (p[j] === "]") j++;
      const end = p.indexOf("]", j);
      if (end === -1) {
        re += "\\[";
        i++;
      } else {
        let body = p.slice(i + 1, end).replace(/\\/g, "\\\\");
        if (body.startsWith("!")) body = "^" + body.slice(1);
        re += `[${body}]`;
        i = end + 1;
      }
    } else if (ch === "\\" && i + 1 < p.length) {
      re += escapeRegexChar(p[i + 1]);
      i += 2;
    } else {
      re += escapeRegexChar(ch);
      i++;
    }
  }

  return re;
}

function escapeRegexChar(ch: string): string {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

/**
 * Parse the contents of a `.gitignore` / `.ignore` file.
 */
export function parseIgnoreFile(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    if (rawLine.startsWith("#")) continue;
    // Trailing spaces are ignored unless escaped with a backslash
    const line = rawLine.replace(/(?<!\\) +$/, "");
    if (line === "") continue;
    const rule = compileGlob(line);
    if (rule) rules.push(rule);
  }
  return rules;
}

/**
 * Evaluate rules against a path relative to the rules' base directory
 * (`/`-separated). Last matching rule wins.
 *
 * Returns true (ignored), false (explicitly re-included by `!`), or
 * undefined when no rule matched.
 */
export function matchRules(
  rules: IgnoreRule[],
  relPath: string,
  isDir: boolean,
): boolean | undefined {
  let result: boolean | undefined;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.regex.test(relPath)) result = !rule.negate;
  }
  return result;
}
