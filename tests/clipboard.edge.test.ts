import { describe, it, expect, beforeEach } from "vitest";
import {
  storeClipboard,
  getClipboard,
  clearClipboard,
  getClipboardStatus,
} from "../src/clipboard.js";

describe("clipboard.ts - Edge Cases", () => {
  beforeEach(() => {
    clearClipboard();
  });

  it("handles storing empty string", () => {
    storeClipboard("");
    expect(getClipboard()).toBe("");
  });

  it("handles storing very large content with unicode and emojis", () => {
    const emojiBlock = "🔥 🚀 💻 🌈 🦄 👾\n".repeat(1000); // ~15KB
    storeClipboard(emojiBlock);

    const retrieved = getClipboard();
    expect(retrieved).toBe(emojiBlock);

    const status = getClipboardStatus();
    expect(status.hasContent).toBe(true);
    expect(status.preview).toContain("🔥 🚀");
    expect(status.preview.length).toBeLessThan(150);
  });

  it("maintains integrity under rapid sequential store-get cycles", () => {
    for (let i = 0; i < 100; i++) {
      storeClipboard(`Value ${i}`);
      const val = getClipboard();
      expect(val).toBe(`Value ${i}`);
    }
  });

  it("handles content with only newlines and whitespace", () => {
    storeClipboard("\n\n\n   \t\t  \n");
    expect(getClipboard()).toBe("\n\n\n   \t\t  \n");
    const status = getClipboardStatus();
    expect(status.hasContent).toBe(true);
  });

  it("handles content with special regex characters", () => {
    const special = ".*+?^${}()|[]\\";
    storeClipboard(special);
    expect(getClipboard()).toBe(special);
  });

  it("handles consume flag correctly", () => {
    storeClipboard("cut me");
    expect(getClipboard(true)).toBe("cut me");
    expect(getClipboard()).toBeNull();
  });

  it("status shows correct line count for multi-line content", () => {
    storeClipboard("line1\nline2\nline3");
    const status = getClipboardStatus();
    expect(status.lines).toBe(3);
  });

  it("status shows correct byte count", () => {
    storeClipboard("hello");
    const status = getClipboardStatus();
    expect(status.bytes).toBe(5);
  });

  it("clear returns confirmation message", () => {
    storeClipboard("data");
    const result = clearClipboard();
    expect(result).toContain("cleared");
    expect(getClipboard()).toBeNull();
  });

  it("status after clear shows empty", () => {
    storeClipboard("data");
    clearClipboard();
    const status = getClipboardStatus();
    expect(status.hasContent).toBe(false);
  });
});
