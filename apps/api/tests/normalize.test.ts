import { describe, expect, it } from "vitest";
import { rupeeStringToPaise, emptyToNull, normalizeTimestamp, normalizeStatus } from "../src/ingestion/normalize.js";

describe("rupeeStringToPaise", () => {
  it("converts a plain positive amount", () => {
    expect(rupeeStringToPaise("1234.56")).toBe(123456);
  });
  it("converts a negative amount", () => {
    expect(rupeeStringToPaise("-500.00")).toBe(-50000);
  });
  it("converts zero", () => {
    expect(rupeeStringToPaise("0.00")).toBe(0);
  });
  it("converts a large amount without float drift", () => {
    // 92,988.17 is a real gross amount from the Day 2 tiny run — this
    // is exactly the kind of value that silently corrupts under
    // (x * 100) float math (92988.17 * 100 = 9298816.999999998 in
    // IEEE 754). The string-split approach never touches a float.
    expect(rupeeStringToPaise("92988.17")).toBe(9298817);
  });
  it("throws on a single-decimal amount instead of silently guessing", () => {
    expect(() => rupeeStringToPaise("1234.5")).toThrow();
  });
  it("throws on a non-numeric amount", () => {
    expect(() => rupeeStringToPaise("abc.de")).toThrow();
  });
});

describe("emptyToNull", () => {
  it("converts empty string to null", () => {
    expect(emptyToNull("")).toBeNull();
  });
  it("converts whitespace-only string to null", () => {
    expect(emptyToNull("   ")).toBeNull();
  });
  it("leaves a real value untouched", () => {
    expect(emptyToNull("CHARGEBACK-1234")).toBe("CHARGEBACK-1234");
  });
});

describe("normalizeTimestamp", () => {
  it("parses a valid ISO UTC timestamp", () => {
    const d = normalizeTimestamp("2026-03-05T14:23:00Z");
    expect(d.toISOString()).toBe("2026-03-05T14:23:00.000Z");
  });
  it("throws on an unparseable timestamp", () => {
    expect(() => normalizeTimestamp("not-a-date")).toThrow();
  });
});

describe("normalizeStatus", () => {
  it("lowercases and trims", () => {
    expect(normalizeStatus("  Captured  ")).toBe("captured");
  });
});
