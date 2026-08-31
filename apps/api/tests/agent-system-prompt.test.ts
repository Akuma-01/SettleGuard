import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "../src/agent/system-prompt.js";

describe("SYSTEM_PROMPT", () => {
  it("keeps recommendation separate from deterministic authorization", () => {
    expect(SYSTEM_PROMPT).toMatch(/policy engine decides whether any action is authorized or auto-resolved/i);
    expect(SYSTEM_PROMPT).toMatch(/Never output "auto_resolve" as an action/);
  });

  it("covers every MVP exception family instead of specializing only in adjustments", () => {
    for (const concept of ["duplicate refunds", "fee or tax mismatches", "unknown adjustments", "missing bank credits", "ambiguous settlement/bank matches"]) {
      expect(SYSTEM_PROMPT).toContain(concept);
    }
  });

  it("requires exact exception identity and record-linked evidence", () => {
    expect(SYSTEM_PROMPT).toMatch(/exceptionId exactly equal/);
    expect(SYSTEM_PROMPT).toContain('"recordId": string');
    expect(SYSTEM_PROMPT).toMatch(/Never invent, alter, or infer a record ID/);
  });
});
