import { describe, it, expect, beforeEach } from "vitest";
import { storeClipboard, getClipboard, clearClipboard, getClipboardStatus } from "../src/clipboard.js";

beforeEach(() => {
  clearClipboard();
});

describe("store", () => {
  it("stores text", () => {
    storeClipboard("hello");
    expect(getClipboard()).toBe("hello");
  });

  it("overwrites previous value", () => {
    storeClipboard("first");
    storeClipboard("second");
    expect(getClipboard()).toBe("second");
  });

  it("stores empty string", () => {
    storeClipboard("");
    expect(getClipboard()).toBe("");
  });

  it("stores multiline text", () => {
    const text = "line1\nline2\nline3";
    storeClipboard(text);
    expect(getClipboard()).toBe(text);
  });

  it("stores large text", () => {
    const text = "x".repeat(100_000);
    storeClipboard(text);
    expect(getClipboard()).toBe(text);
  });
});

describe("get", () => {
  it("returns null when empty", () => {
    expect(getClipboard(false)).toBeNull();
  });

  it("returns stored text", () => {
    storeClipboard("hello");
    expect(getClipboard(false)).toBe("hello");
  });

  it("consumes clipboard when consume=true", () => {
    storeClipboard("hello");
    expect(getClipboard(true)).toBe("hello");
    expect(getClipboard(false)).toBeNull();
  });

  it("does not consume when consume=false", () => {
    storeClipboard("hello");
    expect(getClipboard(false)).toBe("hello");
    expect(getClipboard(false)).toBe("hello");
  });

  it("consume on empty returns null", () => {
    expect(getClipboard(true)).toBeNull();
  });
});

describe("clear", () => {
  it("clears stored text", () => {
    storeClipboard("hello");
    clearClipboard();
    expect(getClipboard(false)).toBeNull();
  });

  it("clear when empty is no-op", () => {
    clearClipboard();
    expect(getClipboard(false)).toBeNull();
  });
});

describe("status", () => {
  it("returns empty when no content", () => {
    const status = getClipboardStatus();
    expect(status.hasContent).toBe(false);
    expect(status.preview).toBe("");
  });

  it("returns hasContent when stored", () => {
    storeClipboard("hello world");
    const status = getClipboardStatus();
    expect(status.hasContent).toBe(true);
    expect(status.preview).toBe("hello world");
  });

  it("truncates preview for long content", () => {
    storeClipboard("x".repeat(200));
    const status = getClipboardStatus();
    expect(status.preview.length).toBeLessThanOrEqual(100);
    expect(status.preview).toContain("...");
  });
});
