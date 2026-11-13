import { expect, test } from "@playwright/test";
import { seedAuth } from "../utils/seed-auth";

test("an Auto Ontology server is connected, and its terms join the map", async ({ page }) => {
  await seedAuth(page);
  await page.goto("/services/add");
  await page.getByRole("combobox", { name: "System" }).fill("nvidia");
  await page.getByRole("option", { name: "NVIDIA Auto Ontology", exact: true }).click();

  // An address and a name are enough: a server reached directly asks for no token.
  const connect = page.getByRole("button", { name: "Connect", exact: true });
  const address = page.getByLabel("Address", { exact: true });
  const token = page.getByLabel("Token", { exact: true });
  await expect(address).toHaveAttribute("type", "url");
  await expect(token).toHaveAttribute("type", "password");
  await expect(connect).toBeDisabled();

  // An address the backend refuses is said in its words.
  await address.fill("http://localhost:3001");
  await page.getByLabel("Name", { exact: true }).fill("terms");
  await connect.click();
  await expect(page.getByText("localhost is this machine or a link-local address")).toBeVisible();
  await expect(page).toHaveURL(/\/services\/add/);
  await address.fill("https://auto-ontology.example");
  await token.fill("a-viewers-token");
  await connect.click();
  await expect(page).toHaveURL(/\/services\/terms$/);

  // It opens on its terms: how many were read, and which system here holds each database.
  await expect(page.getByText("8 terms, read")).toBeVisible();
  const held = page.getByRole("row", { name: /CSPRD/ });
  await expect(held.getByRole("link", { name: "peoplesoft", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /ADMISSIONS/ })).toContainText(
    "No system here holds this database.",
  );
  // It has no schema to show and nothing to provision or sync.
  for (const tab of ["Schema", "Pipeline", "Sync"])
    await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Read again" }).click();
  await expect(page.getByText("8 terms read.", { exact: true })).toBeVisible();
  const stored = await (await page.request.get("/api/ontology/services/terms")).json();
  expect([stored.adapter, stored.status]).toEqual(["auto_ontology", "active"]);
  expect(JSON.stringify(stored)).not.toContain("a-viewers-token");

  // The map draws its terms as a kind of their own.
  await page.getByRole("link", { name: "Open the Semantic map" }).click();
  await expect(page).toHaveURL(/\/map$/);
  await page.getByRole("button", { name: "Legend" }).click();
  const legend = page.getByRole("list", { name: "Legend" });
  await expect(legend.getByRole("button", { name: "Terms, 5" })).toBeVisible();

  // A term is found by another of its names; its panel says what it is and reads its columns.
  const search = page.getByRole("textbox", { name: "Search the graph" });
  await search.fill("learner");
  await page.getByRole("button", { name: /^Student.*Terms$/ }).click();
  await expect(page.getByRole("heading", { name: "Student" })).toBeVisible();
  await expect(page.getByText("Also called learner, pupil.")).toBeVisible();
  await expect(page.getByText("PS_STDNT_BIO.EMPLID")).toBeVisible();

  // A table names the join the server inferred, which no foreign key declares.
  await search.fill("PS_STDNT_ENRL");
  await page
    .getByRole("button", { name: /PS_STDNT_ENRL/ })
    .first()
    .click();
  await expect(page.getByText("Joins (inferred)")).toBeVisible();

  // The server itself is no system on the map, and removing it takes its terms off.
  type Graph = { nodes: { id: string; kind: string }[] };
  const drawn: Graph = await (await page.request.get("/api/ontology/graph?columns=false")).json();
  expect(drawn.nodes.some((n) => n.id === "service:terms")).toBe(false);
  await page.request.delete("/api/ontology/services/terms");
  const left: Graph = await (await page.request.get("/api/ontology/graph?columns=false")).json();
  expect(left.nodes.some((n) => n.kind === "term")).toBe(false);
});
