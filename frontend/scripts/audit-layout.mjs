// Layout audit: every console route × common widths. Flags anything that
// spills outside the content card, header or sidebar, text that overflows its
// own box, and any page that scrolls sideways. Intentional scrollers (tables,
// code blocks, overflow-x-auto) are excluded.
//   NEXT_PUBLIC_DEMO=1 pnpm dev   then   node scripts/audit-layout.mjs [baseUrl]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const routes = ["/dashboard", "/systems", "/map", "/ontology", "/mcp", "/mcp/new", "/mcp/institution", "/agents", "/roles", "/access", "/catalog", "/sync", "/config", "/notifications"];
const widths = [375, 768, 1024, 1280, 1440, 1920];

const browser = await chromium.launch({ channel: "chrome" });
const problems = [];
for (const w of widths) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  for (const r of routes) {
    await page.goto(base + r, { waitUntil: "networkidle" });
    await page.waitForTimeout(r === "/map" ? 1500 : 400);
    const found = await page.evaluate(() => {
      const out = [];
      const label = (el) => {
        const t = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 60);
        return `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 3).join(".") : ""} "${t}"`;
      };
      const clips = (el) => {
        const s = getComputedStyle(el);
        return s.overflowX !== "visible" || s.overflow === "hidden";
      };
      const visible = (el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
      };
      const doc = document.documentElement;
      if (doc.scrollWidth > doc.clientWidth + 1) out.push({ kind: "page-scrolls-sideways", by: doc.scrollWidth - doc.clientWidth });
      const regions = [
        ["card", document.querySelector("main > div")],
        ["header", document.querySelector("header")],
        ["sidebar", document.querySelector("aside")],
      ].filter(([, el]) => el && visible(el));
      for (const [name, region] of regions) {
        const box = region.getBoundingClientRect();
        for (const el of region.querySelectorAll("*")) {
          if (!visible(el)) continue;
          if (el.closest('[data-slot="switch"],[data-slot="checkbox"],[role="switch"],[role="checkbox"]')) continue;
          const pos = getComputedStyle(el).position;
          if (pos === "fixed") continue;
          // skip anything inside an intentional clip/scroll container below the region
          let a = el.parentElement, inside = false;
          while (a && a !== region) {
            if (clips(a)) { inside = true; break; }
            a = a.parentElement;
          }
          if (inside) continue;
          const r = el.getBoundingClientRect();
          if (r.right > box.right + 1 || r.left < box.left - 1) out.push({ kind: `outside-${name}`, el: label(el), by: Math.round(Math.max(r.right - box.right, box.left - r.left)) });
          if (!clips(el) && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).display !== "inline")
            out.push({ kind: `text-spills-${name}`, el: label(el), by: el.scrollWidth - el.clientWidth });
        }
      }
      // siblings that draw on top of each other inside the same flex/grid row
      for (const [name, region] of regions) {
        for (const parent of region.querySelectorAll("*")) {
          const d = getComputedStyle(parent).display;
          if (!/flex|grid/.test(d) || !visible(parent)) continue;
          const kids = [...parent.children].filter((k) => visible(k) && !["absolute", "fixed"].includes(getComputedStyle(k).position));
          for (let i = 0; i < kids.length; i++)
            for (let j = i + 1; j < kids.length; j++) {
              const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
              const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (ix > 2 && iy > 2) out.push({ kind: `overlap-${name}`, el: label(kids[i]) + " ⟷ " + label(kids[j]), by: Math.round(ix) });
            }
        }
      }
      // keep only the outermost offender per kind to cut noise
      const seen = new Set();
      return out.filter((p) => { const k = p.kind + p.el; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
    });
    for (const f of found) problems.push({ width: w, route: r, ...f });
  }
  await page.close();
}
await browser.close();
if (!problems.length) console.log("No layout problems found.");
else {
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log(`${String(p.width).padStart(4)}  ${p.route.padEnd(18)} ${p.kind.padEnd(22)} +${p.by}px  ${p.el ?? ""}`);
}
