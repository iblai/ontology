import { expect, test } from "@playwright/test";
import { seedAuth } from "../utils/seed-auth";

test("toolsets, tools and the raw tools.yaml are editable", async ({ page }) => {
  await seedAuth(page);
  await page.goto("/mcp");

  await page.getByRole("tab", { name: "Toolsets" }).click();
  await page.getByRole("button", { name: "Add toolset" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("qa-tools");
  await dialog.getByRole("checkbox").first().click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("qa-tools", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page.getByRole("row", { name: /get-student-enrollment/ }).click();
  // The tool's own field precedes each parameter's "Description".
  await dialog
    .getByLabel("Description", { exact: true })
    .first()
    .fill("Enrollment by EMPLID (edited)");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("row", { name: /Enrollment by EMPLID \(edited\)/ })).toBeVisible();

  await page.getByRole("tab", { name: "tools.yaml" }).click();
  const editor = page.getByRole("textbox", { name: "tools.yaml" });
  const original = await editor.inputValue();
  await editor.fill(original + "\nkind: [\n");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await editor.fill(original + "\n# reviewed\n");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/tools\.yaml saved\./)).toBeVisible();
});
