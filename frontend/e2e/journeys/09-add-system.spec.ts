import { expect, test, type Page } from "@playwright/test";
import { seedAuth } from "../utils/seed-auth";

/** Where each named part of the form starts and ends, in px. */
async function edges(page: Page, selectors: string[]) {
  return page.evaluate(
    (all) =>
      all.map((selector) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`no ${selector}`);
        const rect = el.getBoundingClientRect();
        return [Math.round(rect.left), Math.round(rect.right)];
      }),
    selectors,
  );
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("a database is added through typed fields, a digits-only port and a looked-up name", async ({
  page,
}) => {
  await seedAuth(page);
  await page.goto("/services/add");

  // Only what connects is offered: Twenty and the nine engines, searchable.
  const system = page.getByRole("combobox", { name: "System" });
  await expect(page.getByRole("option")).toHaveCount(10);
  await system.fill("post");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("option", { name: "PostgreSQL", exact: true }).click();
  await expect(page.getByRole("button", { name: "Change" })).toBeVisible();

  // Each field is of its kind: nothing to autofill, capitalise or spell-check.
  const host = page.getByLabel("Host", { exact: true });
  const port = page.getByLabel("Port", { exact: true });
  const user = page.getByLabel("User", { exact: true });
  const password = page.getByLabel("Password", { exact: true });
  await expect(host).toHaveAttribute("inputmode", "url");
  await expect(host).toHaveAttribute("autocapitalize", "none");
  await expect(host).toHaveAttribute("spellcheck", "false");
  await expect(port).toHaveAttribute("inputmode", "numeric");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("autocomplete", "new-password");

  // The port comes with the engine, takes digits only, and says when it is no port.
  await expect(port).toHaveValue("5432");
  await port.fill("70000");
  await expect(page.getByText("A number from 1 to 65535.")).toBeVisible();
  await port.fill("5a4b3c2");
  await expect(port).toHaveValue("5432");

  // The database is picked from what the login may open, asked on leaving a field.
  const database = page.getByLabel("Database", { exact: true });
  await expect(database).toBeDisabled();
  await expect(page.getByText("Listed once the host, port, user and password")).toBeVisible();
  await host.fill("db.example.com");
  await user.fill("ro");
  await password.fill("wrong");
  await password.blur();
  // A refusal is said in the backend's words, and the name can still be typed.
  await expect(page.getByText('password authentication failed for user "ro"')).toBeVisible();
  await expect(database).toHaveJSProperty("tagName", "INPUT");
  await password.fill("right");
  await password.blur();
  await expect(database).toHaveJSProperty("tagName", "BUTTON");
  await database.click();
  await expect(page.getByRole("option")).toHaveText(["analytics", "crm", "warehouse"]);
  await page.getByRole("option", { name: "crm" }).click();

  // The name follows the database until it is typed, and stays a slug.
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toHaveValue("crm");
  await name.fill("Sales CRM");
  await expect(name).toHaveValue("sales-crm");

  // One column: everything starts on one line and ends on another, and nothing scrolls sideways.
  const starts = await edges(page, [
    '[data-slot="picker"]',
    "#host",
    "#user",
    "#database",
    "#name",
  ]);
  expect(new Set(starts.map(([left]) => left)).size).toBe(1);
  const ends = await edges(page, [
    '[data-slot="picker"]',
    "#port",
    "#password",
    "#database",
    "#name",
    'form button[type="submit"]',
  ]);
  expect(new Set(ends.map(([, right]) => right)).size).toBe(1);
  expect(await sideways(page)).toBe(0);

  await page.getByRole("button", { name: "Add and discover" }).click();
  await expect(page).toHaveURL(/\/services\/sales-crm$/);
  const stored = await (await page.request.get("/api/ontology/services/sales-crm")).json();
  expect([stored.adapter, stored.port, stored.database, stored.status]).toEqual([
    "generic-postgres",
    5432,
    "crm",
    "pending",
  ]);
  // The login never comes back.
  expect(JSON.stringify(stored)).not.toContain("right");
});

test("Twenty is connected with its key alone, and a wrong key is said at once", async ({
  page,
}) => {
  await seedAuth(page);
  // A catalog entry that connects opens the form on itself; one that does not, on the list.
  await page.goto("/services/add?from=canvas");
  await expect(page.getByRole("option")).toHaveCount(10);
  await page.goto("/services/add?from=twenty");
  await expect(page.getByRole("button", { name: "Change" })).toBeVisible();

  const connect = page.getByRole("button", { name: "Connect", exact: true });
  const key = page.getByLabel("API key", { exact: true });
  await expect(page.getByRole("combobox", { name: "Where it runs" })).toHaveText("Twenty cloud");
  await expect(key).toHaveAttribute("type", "password");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("twenty");
  await expect(connect).toBeDisabled();

  // Self-hosted asks for an address, which is a URL over https.
  await page.getByRole("combobox", { name: "Where it runs" }).click();
  await page.getByRole("option", { name: "Self-hosted" }).click();
  const address = page.getByLabel("Address", { exact: true });
  await expect(address).toHaveAttribute("type", "url");
  await key.fill("wrong");
  await address.fill("http://crm.example.com");
  await expect(page.getByText("An address starts with https://")).toBeVisible();
  await expect(connect).toBeDisabled();
  await address.fill("https://crm.example.com");

  await connect.click();
  await expect(page.getByText("Twenty refused the API key: Token invalid.")).toBeVisible();
  await expect(page).toHaveURL(/\/services\/add/);
  await key.fill("a-working-key");
  await connect.click();
  await expect(page).toHaveURL(/\/services\/twenty$/);
  // No review and no Approve: it is active, and the key is not sent back.
  const stored = await (await page.request.get("/api/ontology/services/twenty")).json();
  expect([stored.adapter, stored.status, stored.host]).toEqual([
    "twenty_api",
    "active",
    "https://crm.example.com",
  ]);
  expect(JSON.stringify(stored)).not.toContain("a-working-key");
  expect(await sideways(page)).toBe(0);

  // Connecting it made the role of its name, which the agent dialog offers first.
  await page.goto("/agents");
  await page.getByRole("button", { name: "Connect an agent" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Role" })).toHaveText("Twenty CRM");
  await expect(dialog.getByText("Can change data through twenty-writes.")).toBeVisible();
  await page.keyboard.press("Escape");

  // Removing the system takes the role with it: nothing else was added to it.
  await page.request.delete("/api/ontology/services/twenty");
  const roles: { name: string }[] = await (await page.request.get("/api/ontology/roles")).json();
  expect(roles.map((r) => r.name)).not.toContain("twenty");
});
