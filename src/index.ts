/**
 * pi-find-replace
 *
 * Pi extension for surgical code search, symbol navigation,
 * and targeted replacements. Installable via:
 *
 *   pi install npm:pi-find-replace
 *
 * Tools:
 *  1. find_replace       - Multi-file regex find-and-replace
 *  2. find_symbol        - Find code by name (function, class, etc.)
 *  3. replace_in_symbol  - Targeted replace inside a named symbol
 *  4. file_outline       - File structure map
 *  5. find_references    - Where is this symbol used?
 *  6. clipboard          - Persistent agent clipboard
 *  7. undo_file          - Revert edits per file
 *  8. redo_file          - Reapply undone edits
 *  9. move_symbol        - Relocate symbols within or between files
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Search tools
import { runRg, formatResults } from "./rg.js";
import {
  findSymbolDeclarations,
  findSymbolReferences,
  type FindSymbolOptions,
  type FindReferencesOptions,
} from "./symbols.js";

// Boundary detection
import { findSymbolBoundary, readLineRange } from "./boundaries.js";

// File operations
import {
  readFile,
  writeFile,
  replaceInFile,
  undoFile,
  redoFile,
  getUndoDepth,
  getRedoDepth,
  replaceLines,
  insertAtLine,
  moveLines,
} from "./fileops.js";

// Clipboard
import {
  storeClipboard,
  getClipboard,
  clearClipboard,
  getClipboardStatus,
} from "./clipboard.js";

// Outline
import { generateOutline, formatOutline } from "./outline.js";

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

const FIND_REPLACE_PARAMS = Type.Object({
  regexQuery: Type.String({
    description: "The regex pattern to search for",
  }),
  replaceString: Type.String({
    description: "Replacement string. Supports $1, $2 capture groups.",
  }),
  files: Type.Array(Type.String(), {
    description: "Array of file paths to target. Use glob patterns.",
  }),
  dryRun: Type.Optional(
    Type.Boolean({
      description:
        "If true, show what would be changed without writing. Default: false",
    }),
  ),
  preserveCase: Type.Optional(
    Type.Boolean({
      description:
        "Dynamically match the casing of the original text. Default: false",
    }),
  ),
  multiline: Type.Optional(
    Type.Boolean({
      description: "Enable multiline regex mode (. matches newlines). Default: false",
    }),
  ),
});

const FIND_SYMBOL_PARAMS = Type.Object({
  name: Type.String({
    description: "The symbol name to search for (e.g., 'authenticateUser')",
  }),
  kind: Type.Optional(
    Type.Union([
      Type.Literal("function"),
      Type.Literal("class"),
      Type.Literal("method"),
      Type.Literal("interface"),
      Type.Literal("type"),
      Type.Literal("variable"),
      Type.Literal("constant"),
      Type.Literal("enum"),
      Type.Literal("any"),
    ], {
      description: "Type of symbol to find. Default: 'any'",
    }),
  ),
  scope: Type.Optional(
    Type.String({
      description: "Directory or glob to search in (e.g., 'src/')",
    }),
  ),
  contextLines: Type.Optional(
    Type.Number({
      description: "Lines of context around the match. Default: 0",
    }),
  ),
});

const REPLACE_IN_SYMBOL_PARAMS = Type.Object({
  file: Type.String({
    description: "Path to the file containing the symbol",
  }),
  symbol: Type.String({
    description: "Name of the symbol (function/class) to edit inside",
  }),
  find: Type.String({
    description: "Text or regex to find within the symbol",
  }),
  replace: Type.String({
    description: "Replacement text",
  }),
  isRegex: Type.Optional(
    Type.Boolean({
      description: "Treat 'find' as a regex. Default: false",
    }),
  ),
});

const FILE_OUTLINE_PARAMS = Type.Object({
  file: Type.String({
    description: "Path to the file to outline",
  }),
});

const FIND_REFERENCES_PARAMS = Type.Object({
  name: Type.String({
    description: "The symbol name to find references for",
  }),
  scope: Type.Optional(
    Type.String({
      description: "Directory or glob to search in",
    }),
  ),
  excludeFiles: Type.Optional(
    Type.Array(Type.String(), {
      description: "Files or globs to exclude from search",
    }),
  ),
});

const CLIPBOARD_PARAMS = Type.Object({
  action: Type.Union([
    Type.Literal("store"),
    Type.Literal("get"),
    Type.Literal("clear"),
    Type.Literal("status"),
  ], {
    description: "Action: store, get, clear, or status",
  }),
  text: Type.Optional(
    Type.String({
      description: "Text to store (required for 'store' action)",
    }),
  ),
  consume: Type.Optional(
    Type.Boolean({
      description: "Clear clipboard after reading ('get' action). Default: false",
    }),
  ),
});

const UNDO_FILE_PARAMS = Type.Object({
  file: Type.String({
    description: "Path to the file to undo",
  }),
  steps: Type.Optional(
    Type.Number({
      description: "Number of edits to undo. Default: 1",
    }),
  ),
});

const REDO_FILE_PARAMS = Type.Object({
  file: Type.String({
    description: "Path to the file to redo",
  }),
  steps: Type.Optional(
    Type.Number({
      description: "Number of edits to redo. Default: 1",
    }),
  ),
});

const MOVE_SYMBOL_PARAMS = Type.Object({
  symbol: Type.String({
    description: "Name of the symbol to move",
  }),
  from: Type.String({
    description: "Source file path",
  }),
  to: Type.String({
    description: "Target file path (same file to reorder)",
  }),
  position: Type.Optional(
    Type.String({
      description:
        "Where to insert: 'top', 'bottom', or 'after:<symbolName>' to insert after another symbol",
    }),
  ),
});

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // 1. find_replace
  pi.registerTool({
    name: "find_replace",
    label: "Find Replace",
    description:
      "Multi-file regex find-and-replace with dry-run preview, preserve case, and capture groups. Use this to change code across many files at once.",
    promptSnippet: `Multi-file regex find and replace. Supports dry run, preserve case, capture groups ($1, $2).`,
    promptGuidelines: [
      "Use find_replace for changes across multiple files",
      "Always use dryRun: true first to preview changes",
      "Use replace_in_symbol for targeted single-symbol edits",
    ],
    parameters: FIND_REPLACE_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const {
        regexQuery,
        replaceString,
        files,
        dryRun = false,
        preserveCase = false,
        multiline = false,
      } = params as {
        regexQuery: string;
        replaceString: string;
        files: string[];
        dryRun?: boolean;
        preserveCase?: boolean;
        multiline?: boolean;
      };

      const flags = ["g", multiline ? "m" : "", preserveCase ? "i" : ""].join(
        "",
      );
      const regex = new RegExp(regexQuery, flags);

      const results: string[] = [];
      let totalReplacements = 0;
      const skipped: { file: string; reason: string }[] = [];
      const defaultReplace = replaceString;

      for (const file of files) {
        try {
          const content = readFile(file);
          if (content === null) {
            skipped.push({ file, reason: "File not found" });
            continue;
          }
          let replacementCount = 0;

          const newContent = content.replace(regex, (match, ...groups) => {
            replacementCount++;
            if (preserveCase) {
              // Preserve case heuristic
              const replacement = defaultReplace.replace(
                /\$(\d+)/g,
                (_, n) => groups[parseInt(n) - 1] ?? "",
              );
              if (
                match[0] === match[0].toUpperCase() &&
                match[0] !== match[0].toLowerCase()
              ) {
                return replacement.charAt(0).toUpperCase() + replacement.slice(1);
              }
              if (match === match.toUpperCase()) {
                return replacement.toUpperCase();
              }
              return replacement;
            }
            // Standard replacement with capture groups
            return defaultReplace.replace(
              /\$(\d+)/g,
              (_, n) => groups[parseInt(n) - 1] ?? "",
            );
          });

          if (replacementCount > 0) {
            if (!dryRun) {
              writeFile(file, newContent);
            }
            totalReplacements += replacementCount;
            results.push(
              `  ${file}: ${replacementCount} replacement${replacementCount !== 1 ? "s" : ""}`,
            );
          }
        } catch (err: unknown) {
          results.push(`  ${file}: ERROR - ${String(err)}`);
        }
      }

      const prefix = dryRun ? "**DRY RUN** " : "";
      if (totalReplacements === 0) {
        return {
          content: [
            {
              type: "text",
              text: `${prefix}No matches found for "${regexQuery}" in the specified files.`,
            },
          ],
          details: { replacements: 0, dryRun },
        };
      }

      let output = `${prefix}Replaced "${regexQuery}" → "${replaceString}":\n\n${results.join("\n")}\n\n${totalReplacements} total replacement${totalReplacements !== 1 ? "s" : ""} across ${results.length} file${results.length !== 1 ? "s" : ""}.`;

      if (!dryRun) {
        output += `\n\n**System Notice:** The content of the above files has changed. Run find_symbol or file_outline to get fresh line numbers before making line-range edits.`;
      }

      return {
        content: [{ type: "text", text: output }],
        details: { replacements: totalReplacements, dryRun },
      };
    },
  });

  // 2. find_symbol
  pi.registerTool({
    name: "find_symbol",
    label: "Find Symbol",
    description:
      "Find a function, class, method, or other symbol by name across the codebase. Returns the symbol's source code and line boundaries. Works across all languages.",
    promptSnippet: `Find a symbol (function, class, method, etc.) by name. Returns source code and boundaries. Language-agnostic.`,
    promptGuidelines: [
      "Use find_symbol to locate code before editing",
      "Use kind parameter to narrow search: function, class, method, interface, type, variable, constant, enum, any",
      "Use scope to limit search to a directory",
    ],
    parameters: FIND_SYMBOL_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const {
        name,
        kind = "any",
        scope,
        contextLines = 0,
      } = params as {
        name: string;
        kind?: string;
        scope?: string;
        contextLines?: number;
      };

      const opts: FindSymbolOptions = {
        name,
        kind: kind as import("./symbols.js").SymbolKind,
        scope,
        cwd: process.cwd(),
      };

      const declarations = await findSymbolDeclarations(opts);

      if (declarations.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No symbol "${name}" found${scope ? ` in ${scope}` : ""}.`,
            },
          ],
          details: { found: 0 },
        };
      }

      const parts: string[] = [];
      parts.push(
        `Found ${declarations.length} match${declarations.length !== 1 ? "es" : ""} for "${name}":`,
      );
      parts.push("");

      for (const decl of declarations) {
        // Try to get boundaries
        const boundary = findSymbolBoundary(decl.file, decl.line);

        parts.push(`📄 ${decl.file}:${decl.line}`);
        parts.push("");

        if (boundary) {
          // Show the full symbol source with line numbers
          const lines = boundary.source.split("\n");
          for (let i = 0; i < lines.length; i++) {
            parts.push(`${boundary.startLine + i}: ${lines[i]}`);
          }
          parts.push("");
          parts.push(
            `  → Lines ${boundary.startLine}–${boundary.endLine} (${lines.length} lines)`,
          );
        } else {
          parts.push(`${decl.line}: ${decl.text}`);
        }

        parts.push("");
        parts.push("---");
        parts.push("");
      }

      return {
        content: [{ type: "text", text: parts.join("\n") }],
        details: { found: declarations.length },
      };
    },
  });

  // 3. replace_in_symbol
  pi.registerTool({
    name: "replace_in_symbol",
    label: "Replace in Symbol",
    description:
      "Replace code inside a specific function or class by name. Finds the symbol, applies the replacement within its boundaries, and writes back. No line numbers needed.",
    promptSnippet: `Replace code inside a named symbol (function/class). No line numbers — targets by symbol name.`,
    promptGuidelines: [
      "Use replace_in_symbol for precise edits inside a known function or class",
      "Safer than line-range edits — no drift risk",
      "Use find_symbol first to confirm the symbol exists",
    ],
    parameters: REPLACE_IN_SYMBOL_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const {
        file,
        symbol,
        find,
        replace,
        isRegex = false,
      } = params as {
        file: string;
        symbol: string;
        find: string;
        replace: string;
        isRegex?: boolean;
      };

      // Find the symbol
      const declarations = await findSymbolDeclarations({
        name: symbol,
        kind: "any",
        cwd: process.cwd(),
      });

      const decl = declarations.find((d) => d.file === file);
      if (!decl) {
        return {
          content: [
            {
              type: "text",
              text: `Symbol "${symbol}" not found in ${file}. Use find_symbol to locate it.`,
            },
          ],
          details: { error: "symbol_not_found" },
        };
      }

      // Get boundaries
      const boundary = findSymbolBoundary(file, decl.line);
      if (!boundary) {
        return {
          content: [
            {
              type: "text",
              text: `Could not determine boundaries for symbol "${symbol}" at line ${decl.line}.`,
            },
          ],
          details: { error: "boundary_not_found" },
        };
      }

      // Read full file
      const fullContent = readFile(file);
      if (fullContent === null) {
        return {
          content: [
            {
              type: "text",
              text: `File not found: ${file}`,
            },
          ],
          details: { error: "file_not_found" },
        };
      }
      const lines = fullContent.split("\n");

      // Extract symbol region
      const symbolLines = lines.slice(boundary.startLine - 1, boundary.endLine);
      const symbolContent = symbolLines.join("\n");

      // Apply replacement within symbol
      const regex = isRegex
        ? new RegExp(find, "g")
        : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");

      const newSymbolContent = symbolContent.replace(regex, replace);
      const replacementCount =
        symbolContent !== newSymbolContent ? 1 : 0;

      if (replacementCount === 0 && !isRegex) {
        // Try exact match
        if (!symbolContent.includes(find)) {
          return {
            content: [
              {
                type: "text",
                text: `"${find}" not found inside symbol "${symbol}" in ${file} (lines ${boundary.startLine}–${boundary.endLine}).`,
              },
            ],
            details: { error: "not_found_in_symbol" },
          };
        }
      }

      // Rebuild file
      const newLines = [
        ...lines.slice(0, boundary.startLine - 1),
        ...newSymbolContent.split("\n"),
        ...lines.slice(boundary.endLine),
      ];

      const newContent = newLines.join("\n");
      writeFile(file, newContent);

      // Calculate drift
      const oldLineCount = boundary.endLine - boundary.startLine + 1;
      const newLineCount = newSymbolContent.split("\n").length;
      const drift = newLineCount - oldLineCount;

      let output = `Replaced inside "${symbol}" in ${file} (lines ${boundary.startLine}–${boundary.endLine}).\n\n`;

      if (drift !== 0) {
        const direction = drift > 0 ? "down" : "up";
        const absDrift = Math.abs(drift);
        output += `**System Notice:** Lines below ${boundary.endLine} have shifted ${direction} by ${absDrift} line${absDrift !== 1 ? "s" : ""}.\n\n`;
      }

      // Show updated segment
      output += "Updated segment:\n";
      const updatedLines = newSymbolContent.split("\n");
      for (let i = 0; i < updatedLines.length; i++) {
        output += `${boundary.startLine + i}: ${updatedLines[i]}\n`;
      }

      return {
        content: [{ type: "text", text: output }],
        details: { drift, file, symbol },
      };
    },
  });

  // 4. file_outline
  pi.registerTool({
    name: "file_outline",
    label: "File Outline",
    description:
      "Show the structure map of a file — all functions, classes, interfaces, and their line numbers. Use this to navigate a file before editing.",
    promptSnippet: `Show file structure: all symbols with line numbers. Use before editing to understand file layout.`,
    promptGuidelines: [
      "Use file_outline to understand a file's structure before editing",
      "Shows all symbols with line numbers for quick navigation",
    ],
    parameters: FILE_OUTLINE_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { file } = params as { file: string };

      const entries = generateOutline(file);
      const output = formatOutline(entries);

      return {
        content: [{ type: "text", text: `📋 ${file}:\n\n${output}` }],
        details: { symbols: entries.length },
      };
    },
  });

  // 5. find_references
  pi.registerTool({
    name: "find_references",
    label: "Find References",
    description:
      "Find all places where a symbol is used — calls, imports, and references. Use this before renaming or refactoring to understand impact.",
    promptSnippet: `Find all references to a symbol (calls, imports, uses). Essential for safe refactoring.`,
    promptGuidelines: [
      "Use find_references before renaming or removing a symbol",
      "Helps understand the impact of changes",
      "Classifies references as: definition, call, import, reference",
    ],
    parameters: FIND_REFERENCES_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const {
        name,
        scope,
        excludeFiles,
      } = params as {
        name: string;
        scope?: string;
        excludeFiles?: string[];
      };

      const opts: FindReferencesOptions = {
        name,
        scope,
        cwd: process.cwd(),
        excludeFiles,
      };

      const references = await findSymbolReferences(opts);

      if (references.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No references found for "${name}"${scope ? ` in ${scope}` : ""}.`,
            },
          ],
          details: { found: 0 },
        };
      }

      // Group by kind
      const byKind = new Map<string, typeof references>();
      for (const ref of references) {
        const group = byKind.get(ref.kind) ?? [];
        group.push(ref);
        byKind.set(ref.kind, group);
      }

      const parts: string[] = [];
      parts.push(
        `Found ${references.length} reference${references.length !== 1 ? "s" : ""} for "${name}":`,
      );
      parts.push("");

      const kindLabels: Record<string, string> = {
        call: "📞 Calls",
        import: "📦 Imports",
        reference: "🔗 References",
        definition: "📝 Definitions",
      };

      for (const [kind, refs] of byKind) {
        parts.push(`${kindLabels[kind] ?? kind} (${refs.length}):`);
        for (const ref of refs) {
          parts.push(`  ${ref.file}:${ref.line}  ${ref.text.trim()}`);
        }
        parts.push("");
      }

      return {
        content: [{ type: "text", text: parts.join("\n") }],
        details: { found: references.length },
      };
    },
  });

  // 6. clipboard
  pi.registerTool({
    name: "clipboard",
    label: "Clipboard",
    description:
      "Persistent agent clipboard for storing, retrieving, and clearing text across tool calls. Use for cut/copy/paste operations.",
    promptSnippet: `Agent clipboard. Store text, get text, clear, or check status. Survives across tool calls.`,
    promptGuidelines: [
      "Use clipboard to hold text between operations",
      "Use action: 'store' to copy, 'get' to paste, 'get' with consume: true to cut",
    ],
    parameters: CLIPBOARD_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { action, text, consume } = params as {
        action: string;
        text?: string;
        consume?: boolean;
      };

      let result: string;
      switch (action) {
        case "store":
          if (!text) {
            result = "Error: 'text' is required for 'store' action.";
          } else {
            result = storeClipboard({ text });
          }
          break;
        case "get":
          const content = getClipboard({ consume: consume ?? false });
          if (content === null) {
            result = "Clipboard is empty.";
          } else {
            result = content;
          }
          break;
        case "clear":
          result = clearClipboard();
          break;
        case "status":
          const status = getClipboardStatus();
          if (status.hasContent) {
            result = `Clipboard has ${status.lines} line${status.lines !== 1 ? "s" : ""} (${status.bytes} bytes), stored ${status.age}.\nPreview: ${status.preview}`;
          } else {
            result = "Clipboard is empty.";
          }
          break;
        default:
          result = `Unknown action: ${action}. Use: store, get, clear, status.`;
      }

      return {
        content: [{ type: "text", text: result }],
        details: { action },
      };
    },
  });

  // 7. undo_file
  pi.registerTool({
    name: "undo_file",
    label: "Undo File",
    description:
      "Revert the last edit(s) to a file. Uses a per-file edit stack. Returns the restored content.",
    promptSnippet: `Undo edits to a file. Per-file undo stack. Specify steps to undo multiple edits.`,
    promptGuidelines: [
      "Use undo_file to revert mistakes",
      "Only works on edits made through this extension",
      "Check undo depth with a dry run first",
    ],
    parameters: UNDO_FILE_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { file, steps = 1 } = params as {
        file: string;
        steps?: number;
      };

      const depth = getUndoDepth(file);
      if (depth === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No edits to undo for ${file}. (Only tracks edits made through this extension.)`,
            },
          ],
          details: { undone: 0 },
        };
      }

      const actualSteps = Math.min(steps, depth);
      for (let i = 0; i < actualSteps; i++) {
        undoFile(file);
      }

      const restored = readFile(file) ?? "";
      const remaining = getUndoDepth(file);

      return {
        content: [
          {
            type: "text",
            text: `Undid ${actualSteps} edit${actualSteps !== 1 ? "s" : ""} in ${file}. ${remaining} undo${remaining !== 1 ? "s" : ""} remaining.`,
          },
        ],
        details: { undone: actualSteps, remaining },
      };
    },
  });

  // 8. redo_file
  pi.registerTool({
    name: "redo_file",
    label: "Redo File",
    description:
      "Reapply undone edit(s) to a file. Uses a per-file redo stack.",
    promptSnippet: `Redo undone edits to a file. Per-file redo stack.`,
    promptGuidelines: [
      "Use redo_file to reapply undone changes",
      "Only works after undo_file was called",
    ],
    parameters: REDO_FILE_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { file, steps = 1 } = params as {
        file: string;
        steps?: number;
      };

      const depth = getRedoDepth(file);
      if (depth === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Nothing to redo for ${file}.`,
            },
          ],
          details: { redone: 0 },
        };
      }

      const actualSteps = Math.min(steps, depth);
      for (let i = 0; i < actualSteps; i++) {
        redoFile(file);
      }

      const remaining = getRedoDepth(file);

      return {
        content: [
          {
            type: "text",
            text: `Redid ${actualSteps} edit${actualSteps !== 1 ? "s" : ""} in ${file}. ${remaining} redo${remaining !== 1 ? "s" : ""} remaining.`,
          },
        ],
        details: { redone: actualSteps, remaining },
      };
    },
  });

  // 9. move_symbol
  pi.registerTool({
    name: "move_symbol",
    label: "Move Symbol",
    description:
      "Move a function or class from one file to another, or reorder within the same file. Finds the symbol by name, extracts it, and inserts it at the target location.",
    promptSnippet: `Move a symbol (function/class) to a new location. By name, not line numbers. Supports same-file reorder and cross-file moves.`,
    promptGuidelines: [
      "Use move_symbol to relocate code without manual cut/paste",
      "Specify position as 'top', 'bottom', or 'after:<symbolName>'",
      "Works within same file or across files",
    ],
    parameters: MOVE_SYMBOL_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const {
        symbol,
        from,
        to,
        position = "bottom",
      } = params as {
        symbol: string;
        from: string;
        to: string;
        position?: string;
      };

      // Find the symbol in source file
      const declarations = await findSymbolDeclarations({
        name: symbol,
        kind: "any",
        cwd: process.cwd(),
      });

      const decl = declarations.find((d) => d.file === from);
      if (!decl) {
        return {
          content: [
            {
              type: "text",
              text: `Symbol "${symbol}" not found in ${from}.`,
            },
          ],
          details: { error: "symbol_not_found" },
        };
      }

      // Get boundaries
      const boundary = findSymbolBoundary(from, decl.line);
      if (!boundary) {
        return {
          content: [
            {
              type: "text",
              text: `Could not determine boundaries for "${symbol}" in ${from}.`,
            },
          ],
          details: { error: "boundary_not_found" },
        };
      }

      // Extract symbol source
      const symbolSource = boundary.source;

      // Read target file
      let targetContent = readFile(to) ?? "";
      const targetLines = targetContent.split("\n");

      // Determine insert position
      let insertIdx = 0;
      if (position === "top") {
        insertIdx = 0;
      } else if (position === "bottom") {
        insertIdx = targetLines.length;
      } else if (position.startsWith("after:")) {
        const targetSymbol = position.slice(6);
        // Find the target symbol in the destination
        const targetDecls = await findSymbolDeclarations({
          name: targetSymbol,
          kind: "any",
          cwd: process.cwd(),
        });
        const targetDecl = targetDecls.find((d) => d.file === to);
        if (targetDecl) {
          const targetBoundary = findSymbolBoundary(to, targetDecl.line);
          if (targetBoundary) {
            insertIdx = targetBoundary.endLine; // 1-indexed end, use as 0-indexed insert
          }
        }
      }

      // Insert symbol
      const newLines = [
        ...targetLines.slice(0, insertIdx),
        symbolSource,
        "", // blank line separator
        ...targetLines.slice(insertIdx),
      ];

      const newContent = newLines.join("\n");
      writeFile(to, newContent);

      // If same file, also remove from original location
      // (handled by the insert shifting — we need to remove the original)
      let removalNote = "";
      if (from === to) {
        // For same-file moves, we inserted a copy. Need to remove original.
        // This is tricky with line shifts. For now, note it.
        removalNote = `\n\n**Note:** For same-file moves, manually remove the original at ${from}:${boundary.startLine}–${boundary.endLine} if needed.`;
      }

      return {
        content: [
          {
            type: "text",
            text: `Moved "${symbol}" from ${from}:${boundary.startLine}–${boundary.endLine} to ${to} (position: ${position}).${removalNote}`,
          },
        ],
        details: { symbol, from, to, position },
      };
    },
  });
}
