import { expect, test } from "@playwright/test";
import { paintedEdges } from "../utils/edges";
import { seedAuth } from "../utils/seed-auth";

const ROUTES = [
  "/dashboard",
  "/map",
  "/services",
  "/services/add",
  "/services/canvas",
  "/catalog",
  "/catalog/canvas",
  "/sync",
  "/mcp",
  "/roles",
  "/access",
  "/config",
];

const near = (a: number | null | undefined, b: number | null | undefined) =>
  a != null && b != null && Math.abs(a - b) <= 1;

/** What sits off the content line (`gutter` px in from both sides of the content area) on this page. */
async function offTheLine(
  page: Parameters<typeof paintedEdges>[0],
  gutter: number,
  bar: "crumbs" | "bar",
) {
  const e = await paintedEdges(page);
  const off: string[] = [];
  const start = bar === "crumbs" ? e.crumbs : e.bar;
  if (!near(start?.left, gutter)) off.push(`top bar starts at ${start?.left}`);
  if (!near(e.bar?.right, gutter)) off.push(`top bar ends at ${e.bar?.right}`);
  if (e.toggleMiddle != null && !near(e.toggleMiddle, e.barMiddle))
    off.push(`sidebar toggle centred at ${e.toggleMiddle}, top bar at ${e.barMiddle}`);
  for (const b of e.blocks) {
    if (!b.edges) continue;
    if (b.endOnly ? !near(b.edges.right, gutter) : !near(b.edges.left, gutter))
      off.push(
        `${b.label} ${b.endOnly ? `ends at ${b.edges.right}` : `starts at ${b.edges.left}`}`,
      );
  }
  return off;
}

test("every page starts on the content line, and the top bar starts and ends on it", async ({
  page,
}) => {
  await seedAuth(page);
  const off: string[] = [];
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    off.push(...(await offTheLine(page, 24, "crumbs")).map((o) => `${route}: ${o}`));
  }
  expect(off).toEqual([]);
});

test("on a phone the menu glyph, the content and the top bar's right end share the 16 px lines", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedAuth(page);
  await page.goto("/services");
  await page.waitForLoadState("networkidle");
  expect(await offTheLine(page, 16, "bar")).toEqual([]);
});
