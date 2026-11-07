import { expect, test } from "@playwright/test";
import { seedAuth } from "../utils/seed-auth";

test("the semantic map lists kinds, opens a table and toggles a role grant", async ({ page }) => {
  await seedAuth(page);
  await page.goto("/map");
  await page.getByRole("button", { name: "Legend" }).click();
  const legend = page.getByRole("list", { name: "Legend" });
  await expect(legend.getByRole("button", { name: /^Roles, / })).toBeVisible();

  const search = page.getByRole("textbox", { name: "Search the graph" });
  await search.fill("PS_FIN_AID_AWD");
  await page
    .getByRole("button", { name: /PS_FIN_AID_AWD/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "PS_FIN_AID_AWD" })).toBeVisible();

  await search.fill("role:");
  await page
    .getByRole("button", { name: /Roles$/ })
    .first()
    .click();
  await page.getByRole("checkbox").first().click();
  await expect(page.getByText(/can (now|no longer) reach/)).toBeVisible();
});
