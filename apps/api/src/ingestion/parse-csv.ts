/**
 * SettleGuard — Phase 2, Step 3: CSV ingestion.
 * One bad row shouldn't sink an entire batch — this collects
 * row-level validation errors (with the 1-indexed CSV row number,
 * matching what a person would see if they opened the file) and
 * returns whatever validated cleanly alongside them.
 */

import { readFileSync } from "node:fs";
import Papa from "papaparse";
import type { z } from "zod";

export interface RowError {
  row: number; // 1-indexed, matches the CSV file's own data row numbering (header excluded)
  issues: string[];
}

export interface ParseResult<T> {
  valid: T[];
  errors: RowError[];
  totalRows: number;
}

export function parseAndValidateCsv<T>(filePath: string, schema: z.ZodType<T>): ParseResult<T> {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: true,
  });

  const valid: T[] = [];
  const errors: RowError[] = [];

  parsed.data.forEach((row, i) => {
    const result = schema.safeParse(row);
    if (result.success) {
      valid.push(result.data);
    } else {
      errors.push({
        row: i + 1,
        issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
  });

  return { valid, errors, totalRows: parsed.data.length };
}
