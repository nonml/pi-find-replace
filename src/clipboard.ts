/**
 * Agent clipboard.
 *
 * Persistent text storage that survives across tool calls
 * within a session. Acts as the agent's scratchpad for
 * cut/copy/paste operations.
 */

let clipboard: string | null = null;
let clipboardTimestamp: number | null = null;

export interface ClipboardStoreOptions {
  text: string;
}

export interface ClipboardGetOptions {
  /** Clear clipboard after reading (acts as "cut") */
  consume?: boolean;
}

/**
 * Store text in the clipboard.
 */
export function storeClipboard(opts: ClipboardStoreOptions | string): string {
  const text = typeof opts === "string" ? opts : opts.text;
  clipboard = text;
  clipboardTimestamp = Date.now();
  const len = text.split("\n").length;
  return `Stored ${len} line${len !== 1 ? "s" : ""} (${byteLength(text)} bytes) in clipboard.`;
}

/**
 * Get the current clipboard content.
 */
export function getClipboard(opts: ClipboardGetOptions | boolean = false): string | null {
  if (clipboard === null) {
    return null;
  }

  const consume = typeof opts === "boolean" ? opts : opts.consume ?? false;
  const result = clipboard;
  if (consume) {
    clipboard = null;
    clipboardTimestamp = null;
  }
  return result;
}

/**
 * Clear the clipboard.
 */
export function clearClipboard(): string {
  clipboard = null;
  clipboardTimestamp = null;
  return "Clipboard cleared.";
}

/**
 * Clipboard status info.
 */
export interface ClipboardStatus {
  hasContent: boolean;
  lines: number;
  bytes: number;
  age: string;
  preview: string;
}

/**
 * Get clipboard status without consuming.
 */
export function getClipboardStatus(): ClipboardStatus {
  if (clipboard === null) {
    return {
      hasContent: false,
      lines: 0,
      bytes: 0,
      age: "",
      preview: "",
    };
  }
  const lines = clipboard.split("\n").length;
  const bytes = byteLength(clipboard);
  const age = clipboardTimestamp
    ? formatAge(Date.now() - clipboardTimestamp)
    : "unknown";
  const preview = clipboard.length > 100 ? clipboard.slice(0, 97) + "..." : clipboard;
  return {
    hasContent: true,
    lines,
    bytes,
    age,
    preview,
  };
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf-8");
}

function formatAge(ms: number): string {
  if (ms < 1000) return `${ms}ms ago`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}
