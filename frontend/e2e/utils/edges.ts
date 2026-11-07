import type { Page } from "@playwright/test";

export interface Edges {
  /** Painted left edge, px in from the content area's left. */
  left: number;
  /** Painted right edge, px in from the content area's right. */
  right: number;
}

/**
 * Where things are painted, measured from the content area (the inner `<main>`; the SDK's
 * `SidebarInset` is the outer one): text, `svg`/`img`, or a border or background. Boxes of 1 px or
 * less (`sr-only`) and anything as wide as the content area (full-bleed backgrounds) don't count.
 * `blocks` are the page root's children; a `justify-end` row only has a right edge to keep.
 */
export async function paintedEdges(page: Page) {
  // Let slide-ins finish; infinite animations (spinners, pulses) never do.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    ),
  );
  return page.evaluate(() => {
    const main = document.querySelector("main main");
    if (!main) throw new Error("no content <main>");
    const area = main.getBoundingClientRect();

    const transparent = (c: string) => c === "transparent" || c === "rgba(0, 0, 0, 0)";
    const edges = (root: Element | null) => {
      let left = Infinity;
      let right = -Infinity;
      if (!root) return null;
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      );
      for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
        let rect: DOMRect;
        if (node.nodeType === Node.TEXT_NODE) {
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          rect = range.getBoundingClientRect();
        } else {
          const el = node as Element;
          const s = getComputedStyle(el);
          const painted =
            el.tagName === "svg" ||
            el.tagName === "IMG" ||
            parseFloat(s.borderLeftWidth) > 0 ||
            !transparent(s.backgroundColor) ||
            s.backgroundImage !== "none";
          if (!painted) continue;
          rect = el.getBoundingClientRect();
        }
        if (rect.width <= 1 || rect.height <= 1 || rect.width >= area.width - 1) continue;
        left = Math.min(left, rect.left);
        right = Math.max(right, rect.right);
      }
      return left === Infinity ? null : { left: left - area.left, right: area.right - right };
    };

    const header = document.querySelector("header");
    const blocks = [...(main.firstElementChild?.children ?? [])].map((el) => ({
      edges: edges(el),
      endOnly: getComputedStyle(el).justifyContent === "flex-end",
      label: `${el.tagName.toLowerCase()}.${String(el.getAttribute("class")).split(" ").slice(0, 3).join(".")}`,
    }));
    const bar = header?.getBoundingClientRect();
    const toggle = document
      .querySelector('[aria-label="Collapse sidebar"]')
      ?.getBoundingClientRect();
    return {
      bar: edges(header),
      crumbs: edges(document.querySelector('nav[aria-label="Breadcrumbs"]')),
      blocks,
      /** Vertical centres of the top bar and the SDK sidebar's own toggle (absent on phones). */
      barMiddle: bar ? bar.top + bar.height / 2 : null,
      toggleMiddle: toggle ? toggle.top + toggle.height / 2 : null,
    };
  });
}
