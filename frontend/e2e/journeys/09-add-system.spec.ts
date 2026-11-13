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

  // Only what connects is offered: Twenty, a custom API, Auto Ontology and the nine engines, searchable.
  const system = page.getByRole("combobox", { name: "System" });
  await expect(page.getByRole("option")).toHaveCount(12);
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
  await expect(page.getByRole("option")).toHaveCount(12);
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

test("a custom API is connected, and its endpoints are named one by one", async ({ page }) => {
  await seedAuth(page);
  await page.goto("/services/add");
  await page.getByRole("combobox", { name: "System" }).fill("custom");
  await page.getByRole("option", { name: "Custom API", exact: true }).click();

  const connect = page.getByRole("button", { name: "Connect", exact: true });
  const address = page.getByLabel("Address", { exact: true });
  const token = page.getByLabel("Token", { exact: true });
  await expect(address).toHaveAttribute("type", "url");
  await expect(token).toHaveAttribute("type", "password");
  await expect(page.getByRole("combobox", { name: "Sign-in" })).toHaveText("Bearer token");
  await expect(connect).toBeDisabled();

  // A key in a header of its own asks for the header's name; none asks for nothing.
  await page.getByRole("combobox", { name: "Sign-in" }).click();
  await page.getByRole("option", { name: "A key in a header" }).click();
  await expect(page.getByLabel("Header name", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Sign-in" }).click();
  await page.getByRole("option", { name: "Bearer token" }).click();

  // An address the backend refuses is said in its words.
  await address.fill("https://localhost/v1");
  await token.fill("a-working-token");
  await page.getByLabel("Name", { exact: true }).fill("acme");
  await connect.click();
  await expect(page.getByText("localhost is this machine or a link-local address")).toBeVisible();
  await expect(page).toHaveURL(/\/services\/add/);
  await address.fill("https://api.acme.example/v1");
  await connect.click();
  await expect(page).toHaveURL(/\/services\/acme$/);
  expect(await sideways(page)).toBe(0);

  // It opens on its endpoints, of which there are none, and it has nothing to sync.
  await expect(page.getByText("No endpoints yet.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Sync" })).toHaveCount(0);
  const dialog = page.getByRole("dialog");
  const path = dialog.getByLabel("Path", { exact: true });
  const save = dialog.getByRole("button", { name: "Save" });

  await page.getByRole("button", { name: "Add an endpoint" }).click();
  await dialog.getByLabel("Name", { exact: true }).fill("List invoices");
  await expect(dialog.getByText("Agents see it as acme-list-invoices.")).toBeVisible();
  await dialog.getByLabel("What it does", { exact: true }).fill("Open invoices of a client.");
  await path.fill("invoices");
  await save.click();
  await expect(dialog.getByText("A path starts with /")).toBeVisible();
  await path.fill("/clients/{client_id}/invoices");
  await dialog.getByLabel("Query", { exact: true }).fill("status, limit");
  // A GET sends no body: the switch is for a method that does.
  await expect(dialog.getByRole("switch")).toHaveCount(0);
  await save.click();
  const listed = page.getByRole("row", { name: /acme-list-invoices/ });
  await expect(listed).toBeVisible();

  await page.getByRole("button", { name: "Add an endpoint" }).click();
  await dialog.getByLabel("Name", { exact: true }).fill("Add note");
  await dialog.getByLabel("What it does", { exact: true }).fill("Add a note to an invoice.");
  await dialog.getByRole("combobox", { name: "Method" }).click();
  await page.getByRole("option", { name: "POST", exact: true }).click();
  await expect(dialog.getByRole("switch")).toBeChecked();
  await path.fill("/invoices/{invoice_id}/notes");
  await save.click();
  const noted = page.getByRole("row", { name: /acme-add-note/ });
  await expect(noted).toContainText("changes data");
  // Only an endpoint that reads is tried: a change is always recorded.
  await expect(noted.getByRole("link", { name: "Try" })).toHaveCount(0);

  // Each is a tool of the toolset of its kind, and the key never comes back.
  type Endpoint = { tool: string; method: string; path: string; query: string[]; write: boolean };
  const endpoints: Endpoint[] = await (
    await page.request.get("/api/ontology/services/acme/endpoints")
  ).json();
  expect(endpoints.map((e) => [e.tool, e.method, e.write])).toEqual([
    ["acme-list-invoices", "GET", false],
    ["acme-add-note", "POST", true],
  ]);
  expect(endpoints[0].query).toEqual(["status", "limit"]);
  const toolsets: { name: string; tools: string[]; write?: boolean }[] = await (
    await page.request.get("/api/ontology/mcp/toolsets")
  ).json();
  expect(toolsets.find((t) => t.name === "acme-reads")?.tools).toEqual(["acme-list-invoices"]);
  expect(toolsets.find((t) => t.name === "acme-writes")).toMatchObject({
    write: true,
    tools: ["acme-add-note"],
  });
  const stored = await (await page.request.get("/api/ontology/services/acme")).json();
  expect([stored.adapter, stored.status]).toEqual(["http_api", "active"]);
  expect(JSON.stringify(stored)).not.toContain("a-working-token");

  // Try opens the playground on the endpoint's tool, with its values to fill in.
  await listed.getByRole("link", { name: "Try" }).click();
  await expect(page).toHaveURL(/\/mcp\/playground\?tool=acme-list-invoices$/);
  await expect(page.getByText("client_id")).toBeVisible();

  // Removing the system takes its endpoints, its toolsets and its role with it.
  await page.request.delete("/api/ontology/services/acme");
  const left: { name: string }[] = await (
    await page.request.get("/api/ontology/mcp/toolsets")
  ).json();
  expect(left.map((t) => t.name).filter((n) => n.startsWith("acme-"))).toEqual([]);
  const roles: { name: string }[] = await (await page.request.get("/api/ontology/roles")).json();
  expect(roles.map((r) => r.name)).not.toContain("acme");
});
