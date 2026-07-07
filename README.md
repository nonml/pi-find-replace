# pi-find-replace

Pi extension for surgical code search, symbol navigation, and targeted replacements.

## Install

```bash
pi install npm:pi-find-replace
```

## Tools

### 1. `find_replace` — Multi-file regex find-and-replace

Replace code across multiple files with regex support, capture groups, dry-run preview, and case preservation.

```json
{
  "regexQuery": "oldFunction",
  "replaceString": "newFunction",
  "files": ["src/**/*.ts"],
  "dryRun": true,
  "preserveCase": false,
  "multiline": false
}
```

### 2. `find_symbol` — Find code by name

Find functions, classes, methods, and other symbols by name across any language. Returns source code and line boundaries.

```json
{
  "name": "authenticateUser",
  "kind": "function",
  "scope": "src/",
  "contextLines": 2
}
```

**Kinds:** `function`, `class`, `method`, `interface`, `type`, `variable`, `constant`, `enum`, `any`

### 3. `replace_in_symbol` — Targeted replace inside a symbol

Replace code inside a specific function or class by name. No line numbers needed — finds the symbol, applies the replacement within its boundaries.

```json
{
  "file": "src/auth.ts",
  "symbol": "authenticateUser",
  "find": "return false;",
  "replace": "return verifyToken(req);",
  "isRegex": false
}
```

### 4. `file_outline` — File structure map

Show all symbols in a file with their line numbers. Use before editing to understand file layout.

```json
{
  "file": "src/auth.ts"
}
```

### 5. `find_references` — Where is this symbol used?

Find all places where a symbol is called, imported, or referenced. Essential for safe refactoring.

```json
{
  "name": "authenticateUser",
  "scope": "src/",
  "excludeFiles": ["**/*.test.ts"]
}
```

### 6. `clipboard` — Persistent agent clipboard

Store, retrieve, and clear text across tool calls. Your scratchpad for cut/copy/paste.

```json
{"action": "store", "text": "..."}
{"action": "get", "consume": false}
{"action": "clear"}
{"action": "status"}
```

### 7. `undo_file` — Revert edits

Undo the last edit(s) to a file. Only tracks edits made through this extension.

```json
{
  "file": "src/auth.ts",
  "steps": 1
}
```

### 8. `redo_file` — Reapply undone edits

Redo edits that were undone.

```json
{
  "file": "src/auth.ts",
  "steps": 1
}
```

### 9. `move_symbol` — Relocate symbols

Move a function or class from one file to another, or reorder within the same file.

```json
{
  "symbol": "formatDate",
  "from": "src/utils.ts",
  "to": "src/helpers.ts",
  "position": "after:parseDate"
}
```

**Positions:** `top`, `bottom`, `after:<symbolName>`

## Requirements

- **ripgrep** (`rg`) — Install via your package manager: https://github.com/BurntSushi/ripgrep#installation

## Language Support

All tools work across languages: TypeScript, JavaScript, Python, Rust, Go, Java, C#, C/C++, PHP, Ruby, Swift, Kotlin, and more.

## License

MIT
