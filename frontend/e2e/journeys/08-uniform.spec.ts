import { expect, test, type Page } from "@playwright/test";
import { seedAuth } from "../utils/seed-auth";

const ROUTES = [
  "/dashboard",
  "/services",
  "/services/canvas",
  "/catalog",
  "/catalog/canvas",
  "/sync",
  "/mcp",
  "/roles",
  "/config",
];

/** What breaks the shell's language on this page: a second font outside code, a gradient fill, a tinted status pill. */
function offenders(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const text = (el: Element) => (el.textContent ?? "").trim().slice(0, 40);
    for (const el of document.querySelectorAll<HTMLElement>("header *, main main *")) {
      const cs = getComputedStyle(el);
      const ownText = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
      );
      if (ownText && /monospace/i.test(cs.fontFamily) && !el.closest("pre, textarea, kbd, code"))
        out.push(`mono <${el.tagName.toLowerCase()}> "${text(el)}"`);
      if (cs.backgroundImage.includes("gradient"))
        out.push(`gradient <${el.tagName.toLowerCase()}> "${text(el)}"`);
    }
    for (const pill of document.querySelectorAll<HTMLElement>('[data-slot="status-pill"]')) {
      if (getComputedStyle(pill).backgroundColor !== "rgba(0, 0, 0, 0)")
        out.push(`tinted pill "${text(pill)}"`);
      const dot = pill.firstElementChild;
      if (!dot || getComputedStyle(dot).backgroundColor === "rgba(0, 0, 0, 0)")
        out.push(`pill without a dot "${text(pill)}"`);
    }
    return out;
  });
}

test("every page speaks the shell's language: one font, no gradients, neutral status pills", async ({
  page,
}, testInfo) => {
  await seedAuth(page);
  const found: string[] = [];
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    if (route === "/services/canvas") await page.getByRole("tab", { name: "Sync" }).click();
    found.push(...(await offenders(page)).map((o) => `${route}: ${o}`));
    // One screenshot per page under test-results, to compare the pages by eye after a change.
    await page.screenshot({
      path: testInfo.outputPath(`${route.slice(1).replace(/\//g, "-")}.png`),
    });
  }
  expect(found).toEqual([]);
});

test("a delete confirm is the one red button, and it paints red", async ({ page }) => {
  await seedAuth(page);
  await page.goto("/sync");
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("button", { name: /^Delete .*\?$/ })
    .first()
    .click();
  const action = page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true });
  const paint = await action.evaluate((el) => {
    const cs = getComputedStyle(el);
    // The token painted on a probe, so both sides are the browser's own serialisation.
    const probe = document.body.appendChild(document.createElement("span"));
    probe.style.backgroundColor = "var(--destructive)";
    const destructive = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { image: cs.backgroundImage, color: cs.backgroundColor, destructive };
  });
  expect(paint.image).toBe("none");
  expect(paint.color).toBe(paint.destructive);
});
