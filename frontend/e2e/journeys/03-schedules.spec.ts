import { expect, test } from "@playwright/test";
import { seedAuth } from "../utils/seed-auth";

test("a schedule is created, disabled and deleted", async ({ page }) => {
  await seedAuth(page);
  await page.goto("/sync");
  await page.getByRole("button", { name: "Add schedule" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("nightly-test");
  await dialog.getByLabel("Cron", { exact: true }).fill("0 2 * * *");
  await dialog.getByLabel("Source", { exact: true }).fill("peoplesoft");
  await dialog.getByLabel("Tool", { exact: true }).fill("get-student-enrollment");
  await dialog.getByRole("button", { name: "Save" }).click();
  const row = page.getByRole("row", { name: /nightly-test/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("On")).toBeVisible();

  await row.getByRole("checkbox").click();
  await expect(row.getByText("Off")).toBeVisible();

  await row.getByRole("button", { name: "Delete nightly-test?" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("row", { name: /nightly-test/ })).toHaveCount(0);
});
