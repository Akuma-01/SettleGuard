import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAndValidateCsv } from "../src/ingestion/parse-csv.js";
import { paymentRowSchema } from "../src/ingestion/schemas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(__dirname, "fixtures", "payments-with-errors.csv");

describe("parseAndValidateCsv against a deliberately-corrupted fixture", () => {
  const result = parseAndValidateCsv(fixture, paymentRowSchema);

  it("parses all 5 data rows", () => {
    expect(result.totalRows).toBe(5);
  });

  it("accepts exactly the 2 well-formed rows", () => {
    expect(result.valid).toHaveLength(2);
    expect(result.valid.map((r) => r.payment_id)).toEqual(["PAY_TEST_1", "PAY_TEST_4"]);
  });

  it("rejects the 3-decimal amount on row 2", () => {
    const err = result.errors.find((e) => e.row === 2);
    expect(err).toBeDefined();
    expect(err!.issues.join()).toMatch(/2 places/);
  });

  it("rejects the invalid status enum on row 3", () => {
    const err = result.errors.find((e) => e.row === 3);
    expect(err).toBeDefined();
    expect(err!.issues.join()).toMatch(/Invalid enum value/);
  });

  it("rejects the negative payment amount on row 5", () => {
    const err = result.errors.find((e) => e.row === 5);
    expect(err).toBeDefined();
    expect(err!.issues.join()).toMatch(/not be negative/);
  });

  it("collects exactly 2 valid + 3 invalid = 5 total, none lost or duplicated", () => {
    expect(result.valid.length).toBe(2);
    expect(result.errors.length).toBe(3);
    expect(result.valid.length + result.errors.length).toBe(result.totalRows);
  });
});
