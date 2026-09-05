/**
 * SettleGuard CSV export.
 * Datasets are written as CSV, not JSON, because that's the realistic
 * ingestion format consumed by the CSV and Zod validation pipeline.
 * Amounts are written as rupee decimals (see
 * toRupeeString in utils.ts), not paise, so ingestion normalization
 * performs the conversion.
 */

import { writeFileSync } from "node:fs";

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: (keyof T & string)[]): string {
  const header = columns.join(",");
  const lines = rows.map((row) =>
    columns
      .map((col) => {
        const val = row[col];
        return escapeCsvField(val === null || val === undefined ? "" : String(val));
      })
      .join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

export function writeCsv<T extends Record<string, unknown>>(path: string, rows: T[], columns: (keyof T & string)[]): void {
  writeFileSync(path, toCsv(rows, columns), "utf-8");
}
