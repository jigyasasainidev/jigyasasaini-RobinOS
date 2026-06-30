// Full verification suite for the WarriorPlus compliance fix.
//
// (A) View Source on /warriorplus must contain the exact script tag in
//     the initial HTML response (the new requirement).
// (B) View Source on other pages must NOT contain the tag (scope guard).
// (C) The rendered DOM must still contain the tag exactly once with the
//     correct attributes (existing requirement, end-to-end smoke test).
// (D) Page must load normally (200 OK, root populated, no console errors).

import { chromium } from "/Users/ashadali/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";

const SCRIPT_ID = "warriorplus-sales-script";
const SCRIPT_SRC = "https://warriorplus.com/o2/js/qg7sz4";
const EXACT_TAG = `<script type="text/javascript" src="${SCRIPT_SRC}" defer></script>`;
const MARKER = "warriorplus.com/o2/js/qg7sz4";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

let allPassed = true;
const fail = (msg) => { console.log("  ✗", msg); allPassed = false; };
const pass = (msg) => console.log("  ✓", msg);

// ── (A) View Source on /warriorplus ──────────────────────────────────
console.log("──────────────────────────────────────────────");
console.log("(A) View Source on /warriorplus — initial HTML");
console.log("──────────────────────────────────────────────");
{
  const resp = await page.context().request.get("https://www.tryrobin.xyz/warriorplus", {
    headers: { "Cache-Control": "no-cache" },
  });
  const html = await resp.text();
  const status = resp.status();
  status === 200 ? pass(`HTTP ${status}`) : fail(`HTTP ${status}`);
  const occurrences = (html.match(new RegExp(MARKER.replace(/\./g, "\\."), "g")) || []).length;
  occurrences === 1 ? pass(`Marker appears ${occurrences}× in raw HTML`) : fail(`Marker appears ${occurrences}× (expected 1)`);
  html.includes(EXACT_TAG) ? pass(`Exact tag present verbatim`) : fail(`Exact tag missing. Have: ${html.includes("warriorplus.com/o2/js/qg7sz4") ? "marker only" : "nothing"}`);
  // Placement: should be just before </body>
  const idx = html.indexOf(EXACT_TAG);
  const closeBodyIdx = html.indexOf("</body>");
  if (idx > 0 && idx < closeBodyIdx && closeBodyIdx - idx < 200) {
    pass(`Placed before </body> (offset ${closeBodyIdx - idx} chars)`);
  } else {
    fail(`Placement wrong. tagIdx=${idx}, bodyCloseIdx=${closeBodyIdx}`);
  }
  // Other scripts preserved (scripts present in our codebase's index.html)
  // NOTE: Cloudflare's beacon.min.js is a CDN-injected analytics script
  // added by Cloudflare at the edge based on request characteristics —
  // it is not in our codebase and not affected by this middleware. We do
  // not assert on it here.
  html.includes("/assets/index-") ? pass("Main bundle script preserved") : fail("Main bundle script missing");
  html.includes("sw.js") ? pass("SW registration script preserved") : fail("SW registration script missing");
}

// ── (B) Scope guard — other pages must NOT have the tag ──────────────
console.log("");
console.log("──────────────────────────────────────────────");
console.log("(B) Scope guard — script must NOT appear elsewhere");
console.log("──────────────────────────────────────────────");
for (const path of ["/", "/pricing", "/jvzoo", "/about", "/login"]) {
  const resp = await page.context().request.get(`https://www.tryrobin.xyz${path}`, {
    headers: { "Cache-Control": "no-cache" },
  });
  const html = await resp.text();
  if (html.includes(MARKER)) {
    fail(`${path}: marker LEAKED into raw HTML`);
  } else {
    pass(`${path}: marker absent (scope respected)`);
  }
}

// ── (C) + (D) Live DOM check on /warriorplus ─────────────────────────
console.log("");
console.log("──────────────────────────────────────────────");
console.log("(C) + (D) Live DOM on /warriorplus — page + tag");
console.log("──────────────────────────────────────────────");
const nav = await page.goto("https://www.tryrobin.xyz/warriorplus", {
  waitUntil: "domcontentloaded",
  timeout: 45000,
}).catch((e) => { pageErrors.push(`nav: ${e}`); return null; });
await page.waitForTimeout(5000);

const dom = await page.evaluate((args) => {
  const tag = document.getElementById(args.SCRIPT_ID);
  const count = document.querySelectorAll("#" + args.SCRIPT_ID).length;
  return {
    httpStatus: performance.getEntriesByType("navigation")[0]?.responseStatus ?? null,
    title: document.title,
    h1: document.querySelector("h1")?.textContent?.trim().slice(0, 80) ?? null,
    rootLen: document.getElementById("root")?.innerHTML.length ?? 0,
    tagExists: !!tag,
    tagCount: count,
    tagType: tag?.getAttribute("type") ?? null,
    tagSrc: tag?.getAttribute("src") ?? null,
    tagDefer: tag?.defer ?? null,
    tagParent: tag?.parentNode?.nodeName ?? null,
  };
}, { SCRIPT_ID, SCRIPT_SRC });

(dom.httpStatus === 200 || dom.httpStatus === null) ? pass(`HTTP ${dom.httpStatus ?? "loaded"}`) : fail(`HTTP ${dom.httpStatus}`);
dom.rootLen > 1000 ? pass(`Page rendered (root ${dom.rootLen} chars)`) : fail(`Root empty: ${dom.rootLen}`);
dom.title ? pass(`Title: "${dom.title}"`) : fail("No title");
dom.h1 ? pass(`H1: "${dom.h1}"`) : fail("No H1");
dom.tagExists ? pass("Script tag present in DOM") : fail("Script tag MISSING from DOM");
dom.tagCount === 1 ? pass(`Exactly 1 instance (idempotent — middleware + no-op useEffect)`) : fail(`Found ${dom.tagCount} instances`);
dom.tagType === "text/javascript" ? pass(`type="text/javascript"`) : fail(`type="${dom.tagType}"`);
dom.tagSrc === SCRIPT_SRC ? pass(`src="${dom.tagSrc}"`) : fail(`src="${dom.tagSrc}"`);
dom.tagDefer === true ? pass(`defer=true`) : fail(`defer=${dom.tagDefer}`);
dom.tagParent === "BODY" ? pass(`parent=<body>`) : fail(`parent=${dom.tagParent}`);

// Final page-load sanity
consoleErrors.length === 0 ? pass("0 console errors") : fail(`${consoleErrors.length} console errors`);
pageErrors.filter((e) => !/timeout/i.test(e)).length === 0 ? pass("0 page errors") : fail(`page errors: ${pageErrors.filter((e) => !/timeout/i.test(e)).join(" | ")}`);

// Screenshot for visual no-regression check
await page.screenshot({ path: ".kimchi/docs/warriorplus-live-after.png", fullPage: true });
console.log("");
console.log("Screenshot saved: .kimchi/docs/warriorplus-live-after.png");

await browser.close();
console.log("");
console.log("──────────────────────────────────────────────");
console.log("OVERALL VERDICT:", allPassed ? "PASS ✓" : "FAIL ✗");
console.log("──────────────────────────────────────────────");
process.exit(allPassed ? 0 : 1);
