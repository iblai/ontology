// Captures every console page for docs/. Run with the dev server up:
//   node scripts/screenshots.mjs [baseUrl]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const out = new URL("../../docs/screenshots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const shots = [
  { name: "01-dashboard", path: "/dashboard" },
  { name: "02-systems", path: "/systems" },
  { name: "02b-systems-http-api", path: "/systems", click: 'role=tab[name="HTTP API"]' },
  { name: "03-map", path: "/map", wait: 14000 },
  { name: "04-ontology", path: "/ontology" },
  { name: "05-mcp-servers", path: "/mcp" },
  { name: "06-mcp-new", path: "/mcp/new" },
  { name: "07-server-connect", path: "/mcp/institution" },
  { name: "07b-server-playground", path: "/mcp/institution", click: 'role=tab[name="Playground"]', then: 'role=button[name="Run"]', wait: 1500 },
  { name: "07c-server-activity", path: "/mcp/institution", click: 'role=tab[name="Activity"]' },
  { name: "07d-server-tokens", path: "/mcp/institution", click: 'role=tab[name="Tokens & Origins"]' },
  { name: "08-agents", path: "/agents" },
  { name: "09-roles", path: "/roles" },
  { name: "10-access", path: "/access" },
  { name: "11-catalog", path: "/catalog" },
  { name: "12-compilation", path: "/sync" },
  { name: "13-config", path: "/config" },
];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, colorScheme: "light" });
for (const s of shots) {
  await page.goto(base + s.path, { waitUntil: "networkidle" });
  await page.waitForTimeout(s.wait ?? 800);
  if (s.click) { await page.locator(s.click).first().click(); await page.waitForTimeout(400); }
  if (s.then) { await page.locator(s.then).first().click(); await page.waitForTimeout(s.wait ?? 1200); }
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}${s.name}.png`, fullPage: true });
  console.log("saved", s.name);
}
await browser.close();
