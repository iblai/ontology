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

test("a role is created on the access page and edited by clicking its nodes", async ({ page }) => {
  await seedAuth(page);
  await page.goto("/access");
  await page.getByRole("button", { name: "New role", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New role" });
  await dialog.getByLabel("Name", { exact: true }).fill("Review board");
  await expect(dialog.getByText("Technical name: ReviewBoard")).toBeVisible();
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();

  // The new role is listed and picked, and has a node of its own.
  const picker = page.getByRole("combobox", { name: "Role" });
  await expect(picker).toHaveText("Review board");
  const node = page.getByRole("button", { name: "Review board", exact: true });
  await expect(node).toHaveAttribute("aria-pressed", "true");

  // A click anywhere on a toolset's node is a click on its switch.
  const grant = page.getByRole("switch", { name: "Grant canvas-tools" });
  await expect(grant).not.toBeChecked();
  await grant.locator("xpath=../..").click({ position: { x: 20, y: 58 } });
  await expect(page.getByText("Review board can now reach canvas-tools.")).toBeVisible();
  await expect(grant).toBeChecked();
  // The switch in a memory domain's node still does the same.
  const read = page.getByRole("switch", { name: /^Read / }).first();
  await read.click();
  await expect(read).toBeChecked();

  // The role's node picks it; a second click is all roles again.
  await node.click();
  await expect(node).toHaveAttribute("aria-pressed", "false");
  await expect(picker).toHaveText("All roles");

  await page.reload();
  await page.getByRole("button", { name: "Review board", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Grant canvas-tools" })).toBeChecked();
});

test("a toolset that changes data is granted by name, beside every read-only one", async ({
  page,
}) => {
  await seedAuth(page);
  // Marked as its editor's switch marks it.
  await page.request.put("/api/ontology/mcp/toolsets/canvas-tools", {
    data: {
      kind: "toolset",
      name: "canvas-tools",
      tools: ["get-canvas-activity", "get-canvas-submissions"],
      write: true,
    },
  });
  await page.goto("/access");
  await expect(page.getByText("2 tools · changes data")).toBeVisible();

  // The administrator holds `*`: every read-only toolset, and not this one.
  await page.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: "iblai/ontology Administrator" }).click();
  const grant = page.getByRole("switch", { name: "Grant canvas-tools" });
  const other = page.getByRole("switch", { name: "Grant enrollment-tools" });
  await expect(grant).not.toBeChecked();
  await expect(other).toBeChecked();
  await grant.click();
  await expect(grant).toBeChecked();
  await expect(other).toBeChecked();

  const roles: { name: string; mcp_toolsets: string[] }[] = await (
    await page.request.get("/api/ontology/roles")
  ).json();
  expect(roles.find((r) => r.name === "IblaiOntologyAdmin")?.mcp_toolsets).toEqual([
    "*",
    "canvas-tools",
  ]);
});
