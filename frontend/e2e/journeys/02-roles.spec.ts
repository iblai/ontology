import { expect, test, type Page } from "@playwright/test";
import { seedAuth } from "../utils/seed-auth";

/** One role as the backend holds it now. */
async function stored(page: Page, name: string) {
  const roles: Record<string, unknown>[] = await (
    await page.request.get("/api/ontology/roles")
  ).json();
  return roles.find((r) => r.name === name);
}

test("a role is created, edited and deleted", async ({ page }) => {
  await seedAuth(page);
  await page.goto("/roles");
  await page.getByRole("button", { name: "Add role" }).click();
  const dialog = page.getByRole("dialog");
  // The name is all there is to type: its technical name follows, and nothing is granted yet.
  await dialog.getByLabel("Name", { exact: true }).fill("Auditor");
  await expect(dialog.getByText("Technical name: Auditor")).toBeVisible();
  const rows = dialog.getByRole("combobox", { name: "Rows per cache query" });
  await expect(rows).toHaveText("1,000");
  const grant = dialog.getByRole("switch", { name: "canvas-tools", exact: true });
  await expect(grant).not.toBeChecked();
  await grant.click();
  // A new role is a draft: nothing is stored before Create.
  expect(await stored(page, "Auditor")).toBeUndefined();
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const row = page.getByRole("row", { name: /Auditor/ });
  await expect(row).toBeVisible();

  await row.click();
  await expect(grant).toBeChecked();
  // A role that exists has no Save, and its dialog fits the window: nothing to scroll either way.
  await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
  expect(
    await dialog.evaluate((el) => [
      el.scrollHeight - el.clientHeight,
      el.scrollWidth - el.clientWidth,
    ]),
  ).toEqual([0, 0]);
  // Each change is stored as it is made: the name on leaving its field, the rest at once.
  await dialog.getByLabel("Name", { exact: true }).fill("Audit team");
  await rows.click();
  await page.getByRole("option", { name: "No limit" }).click();
  await grant.click();
  await expect
    .poll(async () => {
      const role = await stored(page, "Auditor");
      return [role?.display_name, role?.concurrency_limits, role?.mcp_toolsets];
    })
    .toEqual(["Audit team", {}, []]);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("row", { name: /Audit team/ })).toBeVisible();

  // The technical name stayed, and the dialog shows what was stored.
  await page.getByRole("row", { name: /Audit team/ }).click();
  await expect(dialog.getByText("Technical name: Auditor")).toBeVisible();
  await expect(rows).toHaveText("No limit");
  await expect(grant).not.toBeChecked();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();

  await page.getByRole("button", { name: "Delete Auditor?" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("row", { name: /Auditor/ })).toHaveCount(0);
});

test("a second role of one name gets a technical name of its own", async ({ page }) => {
  await seedAuth(page);
  await page.goto("/roles");
  await page.getByRole("button", { name: "Add role" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Registrar");
  await expect(dialog.getByText("Technical name: Registrar2")).toBeVisible();
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("row", { name: /Registrar2/ })).toBeVisible();
  // The seeded Registrar still reaches what it did.
  await expect(page.getByRole("row", { name: /enrollment-tools, admissions-tools/ })).toBeVisible();
});

test("a role that reads part of a domain keeps its paths", async ({ page }) => {
  await seedAuth(page);
  await page.goto("/roles");
  await page.getByRole("row", { name: /Student/ }).click();
  const dialog = page.getByRole("dialog");
  // The seeded Student reads its own record only: the switch is locked, not a way to widen it.
  const part = dialog.getByRole("switch", { name: "Read students", exact: true });
  await expect(part).toBeDisabled();
  await expect(part).not.toBeChecked();
  await expect(dialog.getByText("part of it")).toBeVisible();
  await expect(dialog.getByRole("switch", { name: "Read courses", exact: true })).toBeChecked();
  // The switch is the save.
  await dialog.getByRole("switch", { name: "Read enrollment", exact: true }).click();
  await expect
    .poll(async () => (await stored(page, "Student"))?.memory_paths)
    .toEqual([
      "/ontology/students/by-id/${USER_EMPLID}.md",
      "/ontology/courses/**",
      "/ontology/enrollment/**",
    ]);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toBeHidden();
});
