import { expect, test } from "@playwright/test";
import { seedAuth } from "../utils/seed-auth";

test("the shell lists every page, searches with ⌘K and creates from the New menu", async ({
  page,
}) => {
  await seedAuth(page);
  await page.goto("/dashboard");

  const nav = page.getByRole("navigation", { name: "Main navigation" });
  for (const name of [
    "Dashboard",
    "Semantic map",
    "Services",
    "Catalog",
    "Sync",
    "MCP gateway",
    "Roles",
    "Access",
    "Configuration",
  ])
    await expect(nav.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(nav.getByRole("link", { name: /^Services\s*\d+$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Demo data" })).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search pages, services, connectors…").fill("canvas");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/services\/canvas$/);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  await expect(crumbs).toContainText("Services");
  await expect(crumbs).toContainText("canvas");

  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "New role" }).click();
  await expect(page).toHaveURL(/\/roles$/);
  await expect(page.getByRole("dialog", { name: "New role" })).toBeVisible();
});
