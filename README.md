# pi-find-replace

[![npm version](https://img.shields.io/npm/v/pi-find-replace.svg)](https://www.npmjs.com/package/pi-find-replace)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Pi Package](https://img.shields.io/badge/Type-Pi_Extension-green.svg)](#installation)

An advanced, surgical codebase search, structural symbol navigation, and targeted replacement extension for the **[Pi Coding Agent](https://pi.dev)**.

Instead of exhausting context windows on redundant full-file read/write cycles, `pi-find-replace` equips your agent with a localized, language-agnostic toolset to query, extract, modify, and track code changes safely.

---

## Architectural Benefits for AI Agents

Standard shell operations (like `sed` or raw regex) are prone to breaking syntax or failing when target files undergo edits. This extension mitigates those constraints using three core design principles:

* **Line-Drift Resilience:** Tools like `replace_in_symbol` edit strictly inside a symbol's structural boundaries. Line-shift metrics are calculated and reported back dynamically, allowing the agent to update its positional memory without needing to re-read the file.
* **Context Token Economy:** Rather than streaming raw file output, results are parsed, trimmed, and annotated with matching line numbers. Output syntax is optimized for LLM consumption, keeping context usage low.
* **Transactional Isolation:** Features a robust, per-file undo/redo stack. Unlike global git rollbacks, the agent can rollback individual, specific changes inside one target file without affecting its other modifications across the workspace.

---

## Prerequisites & Installation

### Requirements
**No hard requirements.** This extension works out of the box on all platforms.

#### Optional: ripgrep (`rg`) for faster search
For optimal performance, install [ripgrep](https://github.com/BurntSushi/ripgrep#installation) — a high-performance search engine written in Rust. The extension uses a **3-tier fallback chain**:

| Tier | Source | Speed | Setup |
|------|--------|-------|-------|
| 1 | Bundled (`@vscode/ripgrep`) | ⚡ Fastest | Auto-installed via npm |
| 2 | System `rg` command | Fast | `brew install ripgrep` / `apt install ripgrep` / `choco install ripgrep` |
| 3 | Pure JavaScript fallback | Slower | Always available, zero dependencies |

The extension automatically detects which tier is available and uses the fastest option. If you have ripgrep installed (bundled or system), you'll get near-instant search results. Without it, the JavaScript fallback ensures everything still works.

### Installation
Install the extension globally using the Pi CLI package installer:

```bash
pi install npm:pi-find-replace
```

Or install it globally via `npm`:

```bash
npm install -g pi-find-replace
```

To load the extension into your Pi coding agent session:

```bash
pi --extension pi-find-replace
```

*(Alternatively, register `pi-find-replace` inside your global `~/.pi/agent/config.json` under the `"extensions"` array to load it automatically for every session).*

---

## Tool Registry Reference

### 1. `find_replace` — Multi-file Regex Search & Replace
Performs targeted replacements across files matching specific glob paths.

* **Capabilities:** Handles regex capture groups (`$1`, `$2`), multiline queries (where `.` matches `\n`), case preservation (adjusting camelCase, snake_case, or UPPER_CASE dynamically to match the source target), and dry-run reviews.
* **Output:** Returns a detailed report of the affected files, modified match count, and a warning on potential line shifting.

```json
{
  "regexQuery": "function oldCode\\((.*?)\\)",
  "replaceString": "async function newCode($1)",
  "files": ["src/**/*.ts"],
  "dryRun": false,
  "preserveCase": true,
  "multiline": true
}
```

### 2. `find_symbol` — Language-Agnostic Symbol Lookup
Locates functions, classes, methods, and interface definitions by name. Instead of merely showing the definition signature line, it resolves the entire structural block using multi-language boundary analysis.

* **Capabilities:** Restricts queries using `scope` and `kind` filters. Supports optional surrounding context line counts.

```json
{
  "name": "authenticateUser",
  "kind": "function",
  "scope": "src/",
  "contextLines": 2
}
```
* **Supported Kinds:** `function`, `class`, `method`, `interface`, `type`, `variable`, `constant`, `enum`, `any`

### 3. `replace_in_symbol` — Target-Constrained Replacements
Performs text or regex replacements scoped strictly inside a named symbol's boundaries. Since it targets a relative scope, this tool protects edits from line-drift occurring elsewhere in the file.

* **Output:** Executes the replacement, calculates the exact line shift, and displays the newly modified block with corrected absolute line numbers for immediate agent verification.

```json
{
  "file": "src/auth.ts",
  "symbol": "authenticateUser",
  "find": "return false;",
  "replace": "return verifyToken(req);",
  "isRegex": false
}
```

### 4. `file_outline` — Hierarchical Structure Map
Generates a structured mapping of all code symbols declared within a single file. Useful for providing the agent with a architectural file overview before implementing changes.

* **Output:** Returns a list of symbols with nested indentation levels corresponding to scopes, matching the layout structure of VS Code’s Outline view.

```json
{
  "file": "src/auth.ts"
}
```

### 5. `find_references` — Global Usage Tracking
Performs a global workspace search to locate imports, definitions, and invocations of a specific symbol.

* **Output:** Segregates usages into four logical categories to assist the agent in impact analysis:
  - 📞 **Calls:** Direct invocations of the symbol
  - 📦 **Imports:** Import statements and module requirements
  - 🔗 **References:** Mentions, typings, or scalar usage
  - 📝 **Definitions:** The initial declaration location

```json
{
  "name": "authenticateUser",
  "scope": "src/",
  "excludeFiles": ["**/*.test.ts"]
}
```

### 6. `clipboard` — Stateful Session Scratchpad
A temporary clipboard utility. Allows the agent to store, retrieve, or cut code snippets during multi-step refactoring workflows across different sessions or files.

* **Capabilities:** Evaluates and reports code block metrics (line count, byte size, and age). Includes a `consume` mode which acts as a "cut" by returning the content and immediately wiping it from memory.

```json
{"action": "store", "text": "const tempHelper = () => true;"}
{"action": "get", "consume": true}
{"action": "status"}
{"action": "clear"}
```

### 7. `undo_file` — Per-File Transaction Undo
Rolls back modifications on a specified file. Unlike git-level resets, `undo_file` only affects modifications made directly by the extension inside the targeted file.

* **Capabilities:** Supports rolling back multiple steps sequentially and returns the fully restored code state.

```json
{
  "file": "src/auth.ts",
  "steps": 1
}
```

### 8. `redo_file` — Per-File Transaction Redo
Re-applies file edits that were reverted using `undo_file`.

```json
{
  "file": "src/auth.ts",
  "steps": 1
}
```

### 9. `move_symbol` — Structural Reordering & Refactoring
Moves a targeted code block (such as a function or class) from one file to another, or adjusts its position inside the same file.

* **Capabilities:** Leverages the boundary detection engine to safely slice out the whole block. Integrates with the per-file tracking system so the action can be undone.

```json
{
  "symbol": "formatDate",
  "from": "src/utils.ts",
  "to": "src/helpers.ts",
  "position": "after:parseDate"
}
```
* **Supported Positions:** `top`, `bottom`, `after:<symbolName>`

---

## Technical Architecture

### 3-Tier Search Engine
The extension uses a cascading search backend that automatically falls back if a tier is unavailable:

1. **Bundled ripgrep** (`@vscode/ripgrep`) — Pre-compiled binaries shipped with the npm package. Uses ripgrep's JSON interface (`rg --json`) for structured, parse-free output.
2. **System ripgrep** — Falls back to the globally installed `rg` command if the bundled binary is missing.
3. **Pure JavaScript fallback** — A built-in file scanner using Node.js `fs` with regex matching. Slower than ripgrep but guarantees functionality on all platforms with zero native dependencies.

All three tiers produce identical output formats, so the agent sees consistent results regardless of which backend is active.

### Scope Boundary Resolution
The extension dynamically switches boundary-tracking strategies based on the file type:
- **Brace Matching Strategy:** Track matching curly braces, brackets, and parentheses. Default for C, C++, C#, Java, JavaScript, TypeScript, Go, Rust, and JSON.
- **Indentation Analysis Strategy:** Calculates code scopes by tracking visual indentation steps and line-termination offsets. Default for Python and Ruby.
- **Keyword Matching Strategy:** Tracks structural ending terminators (`end`). Default for Swift, Kotlin, and Scala.

---

## Supported Environments
This extension provides multi-language symbol extraction and boundary processing for the following environments:
- **Languages:** TypeScript, JavaScript, Python, Rust, Go, Java, C#, C/C++, PHP, Ruby, Swift, Kotlin, Scala, and YAML.

---

## License

This project is licensed under the MIT License.