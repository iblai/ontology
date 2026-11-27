// Captures every console page for docs/. Run with the dev server up:
//   NEXT_PUBLIC_DEMO=1 pnpm dev   (demo mode: no sign-in needed)
//   node scripts/screenshots.mjs [baseUrl]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const out = new URL("../docs/screenshots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const shots = [
  { name: "01-dashboard", path: "/dashboard" },
  { name: "02-systems", path: "/systems" },
  // A ready-made tile opens the HTTP API tab filled in; the filter keeps it in view.
  {
    name: "02b-systems-http-api",
    path: "/systems",
    click: 'role=button[name="APIs"]',
    andThen: "role=button[name=/Canvas LMS/]",
    wait: 800,
  },
  { name: "03-map", path: "/map", wait: 14000 },
  { name: "04-ontology", path: "/ontology" },
  { name: "05-mcp-servers", path: "/mcp" },
  { name: "06-mcp-new", path: "/mcp/new" },
  { name: "07-server-connect", path: "/mcp/institution" },
  {
    name: "07b-server-playground",
    path: "/mcp/institution",
    click: 'role=tab[name="Playground"]',
    andThen: 'role=button[name="Run"]',
    wait: 1500,
  },
  { name: "07c-server-activity", path: "/mcp/institution", click: 'role=tab[name="Activity"]' },
  {
    name: "07d-server-tokens",
    path: "/mcp/institution",
    click: 'role=tab[name="Tokens & Origins"]',
  },
  { name: "08-agents", path: "/agents" },
  { name: "09-roles", path: "/roles" },
  { name: "10-access", path: "/access" },
  { name: "11-catalog", path: "/catalog" },
  { name: "12-compilation", path: "/sync" },
  { name: "13-config", path: "/config" },
  { name: "14-notifications", path: "/notifications" },
  {
    name: "15-collapsed-sidebar",
    path: "/dashboard",
    click: 'role=button[name="Collapse sidebar"]',
    reset: 'role=button[name="Expand sidebar"]',
  },
  {
    name: "16-organization-menu",
    path: "/dashboard",
    click: 'role=button[name="Switch organization"]',
    viewportOnly: true,
  },
  {
    name: "17-management-dialog",
    path: "/dashboard",
    click: '[data-testid="sidebar-footer"] >> role=button[name="Management"]',
    viewportOnly: true,
  },
  { name: "18-mobile", path: "/dashboard", mobile: true },
  {
    name: "19-mobile-menu",
    path: "/dashboard",
    mobile: true,
    click: 'role=button[name="Open menu"]',
    viewportOnly: true,
  },
];

const browser = await chromium.launch({ channel: "chrome" });
const desktop = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.5,
  colorScheme: "light",
});
const phone = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
for (const s of shots) {
  const page = s.mobile ? phone : desktop;
  await page.goto(base + s.path, { waitUntil: "networkidle" });
  await page.waitForTimeout(s.wait ?? 800);
  if (s.click) {
    await page.locator(s.click).first().click();
    await page.waitForTimeout(400);
  }
  if (s.andThen) {
    await page.locator(s.andThen).first().click();
    await page.waitForTimeout(s.wait ?? 1200);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}${s.name}.png`, fullPage: !s.viewportOnly && !s.mobile });
  if (s.reset) await page.locator(s.reset).first().click();
  await page.keyboard.press("Escape");
  console.log("saved", s.name);
}
await browser.close();
