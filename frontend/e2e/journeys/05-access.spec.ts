import { expect, test } from "@playwright/test";
import { seedAuth } from "../utils/seed-auth";

test("the access flowchart toggles a role grant and a toolset membership", async ({ page }) => {
  await seedAuth(page);
  await page.goto("/access");
  const toolset = page.getByRole("button", { name: "enrollment-tools", exact: true });
  await expect(toolset).toBeVisible();

  await page.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: "Student" }).click();
  const grant = page.getByRole("switch", { name: "Grant canvas-tools" });
  await expect(grant).not.toBeChecked();
  await grant.click();
  await expect(page.getByText("Student can now reach canvas-tools.")).toBeVisible();
  await expect(grant).toBeChecked();

  await toolset.click();
  const member = page
    .getByRole("switch", { name: / in enrollment-tools$/, checked: false })
    .first();
  const label = (await member.getAttribute("aria-label"))!;
  await member.click();
  await expect(page.getByText(/added to enrollment-tools\./)).toBeVisible();

  // The state lives on the server: a fresh page still shows it.
  await page.reload();
  await toolset.click();
  await expect(page.getByRole("switch", { name: label })).toBeChecked();
});
