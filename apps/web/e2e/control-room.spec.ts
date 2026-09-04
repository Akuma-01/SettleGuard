import { expect, test } from "@playwright/test";

test("operator can reconcile demo data and inspect real exception evidence", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Systems operational")).toBeVisible();

  await page.getByRole("button", { name: "Run demo" }).click();
  await expect(page).toHaveURL(/\?runId=\d+&notice=/, { timeout: 30_000 });
  await expect(page.getByText("Demo batch loaded and reconciled.")).toBeVisible();
  await expect(page.getByText("Match rate", { exact: true })).toBeVisible();
  await expect(page.getByText("Amount at risk", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Priority case.*Inspect evidence/i })).toBeVisible();
  await expect(page.getByRole("region", { name: "Demo workflow" })).toContainText("Reconcile");
  await expect(page.getByRole("region", { name: "Demo workflow" })).toContainText("Investigate");
  await expect(page.getByRole("region", { name: "Demo workflow" })).toContainText("Control");
  if (process.env.CAPTURE_DEMO_ASSETS === "1") {
    await page.screenshot({ path: "../../docs/assets/control-room-dashboard.png", fullPage: true });
  }

  const runId = new URL(page.url()).searchParams.get("runId");
  expect(runId).toMatch(/^\d+$/);
  await page.goto(`/exceptions?runId=${runId}`);
  await expect(page.getByText(/exceptions found/)).toBeVisible();
  const firstView = page.getByRole("link", { name: "View →" }).first();
  await expect(firstView).toBeVisible();
  await firstView.click();
  await expect(page.getByRole("heading", { name: "Recorded evidence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Latest completed investigation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit trail" })).toBeVisible();
  if (process.env.CAPTURE_DEMO_ASSETS === "1") {
    await page.screenshot({ path: "../../docs/assets/exception-evidence.png", fullPage: true });
  }

  await page.getByRole("link", { name: /Audit trail/ }).click();
  await expect(page.getByRole("heading", { name: "Control history" })).toBeVisible();
});
