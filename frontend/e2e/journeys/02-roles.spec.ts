import { expect, test } from "@playwright/test";
import { seedAuth } from "../utils/seed-auth";

test("a role is created, edited and deleted", async ({ page }) => {
  await seedAuth(page);
  await page.goto("/roles");
  await page.getByRole("button", { name: "Add role" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Auditor");
  await dialog.getByLabel("Display name", { exact: true }).fill("Auditor");
  await dialog.getByRole("button", { name: "Save" }).click();
  const row = page.getByRole("row", { name: /Auditor/ });
  await expect(row).toBeVisible();

  await row.click();
  await dialog.getByLabel("Display name", { exact: true }).fill("Audit team");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("row", { name: /Audit team/ })).toBeVisible();

  await page.getByRole("button", { name: "Delete Auditor?" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("row", { name: /Auditor/ })).toHaveCount(0);
});
