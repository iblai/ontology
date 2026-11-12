import { expect, test } from "@playwright/test";
import { seedAuth } from "../utils/seed-auth";

test("an agent is connected as a role, listed without its key, and removed", async ({ page }) => {
  await seedAuth(page);
  // A toolset that changes data, which the Registrar role holds.
  const toolsets: { name: string }[] = await (
    await page.request.get("/api/ontology/mcp/toolsets")
  ).json();
  const admissions = toolsets.find((s) => s.name === "admissions-tools");
  await page.request.put("/api/ontology/mcp/toolsets/admissions-tools", {
    data: { ...admissions, write: true },
  });

  await page.goto("/agents");
  await expect(page.getByText("No agent is connected yet")).toBeVisible();
  await page.getByRole("button", { name: "Connect an agent" }).click();
  const dialog = page.getByRole("dialog");
  const connect = dialog.getByRole("button", { name: "Connect", exact: true });

  // The first role that can change data is already picked, and says so; nothing connects without an agent.
  const role = dialog.getByRole("combobox", { name: "Role" });
  await expect(role).toHaveText("Registrar");
  await expect(dialog.getByText("Can change data through admissions-tools.")).toBeVisible();
  await expect(connect).toBeDisabled();

  // The agent is searched for; two of one name are told apart by the start of their ids.
  await dialog.getByRole("combobox", { name: "Agent" }).fill("advis");
  await expect(dialog.getByRole("option")).toHaveCount(2);
  await dialog.getByRole("option", { name: /7b61e4d2/ }).click();
  // Another role says what it reaches instead.
  await role.click();
  await page.getByRole("option", { name: "Financial Aid Counselor", exact: true }).click();
  await expect(dialog.getByText("Reads only.")).toBeVisible();
  await role.click();
  await page.getByRole("option", { name: "Registrar", exact: true }).click();
  await expect(dialog.getByText("Can change data through admissions-tools.")).toBeVisible();
  // The dialog fits its window: nothing to scroll either way.
  expect(
    await dialog.evaluate((el) => [
      el.scrollHeight - el.clientHeight,
      el.scrollWidth - el.clientWidth,
    ]),
  ).toEqual([0, 0]);

  await connect.click();
  await expect(dialog).toBeHidden();
  const row = page.getByRole("row", { name: /Advising coach/ });
  await expect(row).toContainText("Registrar");
  // What the console is sent names the key by its fingerprint, never the key.
  const stored: Record<string, string>[] = await (
    await page.request.get("/api/ontology/agent-connections")
  ).json();
  expect(Object.keys(stored[0]).sort()).toEqual([
    "agent",
    "agent_name",
    "created_at",
    "created_by",
    "fingerprint",
    "name",
    "role",
  ]);

  // The same agent as the same role is one connection: the refusal is the backend's.
  await page.getByRole("button", { name: "Connect an agent" }).click();
  await dialog.getByRole("combobox", { name: "Agent" }).fill("7b61");
  await dialog.getByRole("option", { name: /7b61e4d2/ }).click();
  await role.click();
  await page.getByRole("option", { name: "Registrar", exact: true }).click();
  await connect.click();
  await expect(page.getByText("already connected as Registrar")).toBeVisible();
  await page.keyboard.press("Escape");

  // Removing it says what happens to the key, and empties the list.
  await row.getByRole("button", { name: /Remove Advising coach/ }).click();
  await expect(page.getByText("Its key is deleted at once")).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("No agent is connected yet")).toBeVisible();
});
