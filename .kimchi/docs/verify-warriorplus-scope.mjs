// Negative verification: confirm the WarriorPlus compliance script is NOT
// injected on other pages. Proves the "only on /warriorplus" requirement.

import { chromium } from "/Users/ashadali/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";

const SCRIPT_ID = "warriorplus-sales-script";
const SCRIPT_SRC = "https://warriorplus.com/o2/js/qg7sz4";

const PAGES = [
  { path: "/",            label: "homepage" },
  { path: "/pricing",     label: "pricing" },
  { path: "/jvzoo",       label: "jvzoo page" },
  { path: "/about",       label: "about" },
  { path: "/login",       label: "login" },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

console.log("Scope check: script id '" + SCRIPT_ID + "' must NOT appear on these pages:");
let allClean = true;

for (const { path, label } of PAGES) {
  await page.goto("https://www.tryrobin.xyz" + path, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3500);
  const found = await page.evaluate((id) => !!document.getElementById(id), SCRIPT_ID);
  const status = found ? "FAIL — script present" : "ok — script absent";
  if (found) allClean = false;
  console.log("  " + path.padEnd(12) + " (" + label.padEnd(12) + ")  ->  " + status);
}

await browser.close();
console.log("\nSCOPE VERDICT: " + (allClean ? "PASS ✓" : "FAIL ✗"));
process.exit(allClean ? 0 : 1);
