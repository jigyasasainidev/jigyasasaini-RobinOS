// Visual sanity check: full-page screenshot of /warriorplus to confirm
// no UI/layout regression from the script injection.
import { chromium } from "/Users/ashadali/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.goto("https://www.tryrobin.xyz/warriorplus", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: ".kimchi/docs/warriorplus-live.png", fullPage: true });
const ctaCount = await page.evaluate(() => document.querySelectorAll('a[href*="warriorplus.com"]').length);
console.log("Screenshot saved: .kimchi/docs/warriorplus-live.png");
console.log("WarriorPlus CTA anchors on page:", ctaCount);
await browser.close();
