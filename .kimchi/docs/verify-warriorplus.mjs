// Verification script: confirms the WarriorPlus sales page loads normally
// AND that the compliance script is injected into the rendered DOM.
// Runs against the live production URL only.

import { chromium } from "/Users/ashadali/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";

const URL = "https://www.tryrobin.xyz/warriorplus";
const SCRIPT_ID = "warriorplus-sales-script";
const SCRIPT_SRC = "https://warriorplus.com/o2/js/qg7sz4";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => pageErrors.push(String(err)));

let status = null;
try {
  const resp = await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  status = resp ? resp.status() : null;
} catch (e) {
  pageErrors.push(`navigation: ${String(e)}`);
}

// Allow lazy-loaded chunk + post-mount useEffect to settle
await page.waitForTimeout(5000);

const result = await page.evaluate((args) => {
  const script = document.getElementById(args.SCRIPT_ID);
  const foundCount = document.querySelectorAll(`#${args.SCRIPT_ID}`).length;
  const rootHasContent = (document.getElementById("root")?.innerHTML.length ?? 0) > 1000;
  const titleText = document.title;
  const visibleH1 = document.querySelector("h1")?.textContent?.trim().slice(0, 80) ?? null;
  return {
    scriptExists: !!script,
    scriptTagName: script?.tagName ?? null,
    scriptType: script?.getAttribute("type") ?? null,
    scriptSrc: script?.getAttribute("src") ?? null,
    scriptDefer: script?.defer ?? null,
    scriptId: script?.id ?? null,
    foundCount,
    parentTag: script?.parentNode?.nodeName ?? null,
    rootHasContent,
    titleText,
    visibleH1,
  };
}, { SCRIPT_ID, SCRIPT_SRC });

console.log("─────────────────────────────────────────────");
console.log("PRODUCTION VERIFICATION — /warriorplus");
console.log("─────────────────────────────────────────────");
console.log("HTTP status        :", status);
console.log("Page loaded        :", result.rootHasContent ? "YES" : "NO");
console.log("Document title     :", result.titleText);
console.log("First H1           :", result.visibleH1);
console.log("─────────────────────────────────────────────");
console.log("Compliance script tag in DOM:");
console.log("  id               :", result.scriptId);
console.log("  tag              :", result.scriptTagName);
console.log("  type             :", result.scriptType);
console.log("  src              :", result.scriptSrc);
console.log("  defer            :", result.scriptDefer);
console.log("  parent           :", result.parentTag);
console.log("  instances found  :", result.foundCount);
console.log("  expected id      :", SCRIPT_ID);
console.log("  expected src     :", SCRIPT_SRC);
console.log("─────────────────────────────────────────────");
console.log("Console errors     :", consoleErrors.length);
consoleErrors.slice(0, 5).forEach((e, i) => console.log(`  [${i}]`, e.slice(0, 200)));
console.log("Page errors        :", pageErrors.length);
pageErrors.slice(0, 5).forEach((e, i) => console.log(`  [${i}]`, e.slice(0, 200)));
console.log("─────────────────────────────────────────────");

const allGood =
  status === 200 &&
  result.rootHasContent &&
  result.scriptExists &&
  result.foundCount === 1 &&
  result.scriptSrc === SCRIPT_SRC &&
  result.scriptType === "text/javascript" &&
  result.parentTag === "BODY" &&
  result.scriptDefer === true;

console.log("VERDICT            :", allGood ? "PASS ✓" : "FAIL ✗");

await browser.close();
process.exit(allGood ? 0 : 1);
