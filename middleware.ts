// ─────────────────────────────────────────────────────────────────────────
// WARRIORPLUS COMPLIANCE — EDGE MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────
// WarriorPlus marketplace compliance scanners inspect the *raw HTML*
// response (View Source), not the post-hydration DOM. To guarantee the
// official Sales Page Code and the official Buy Button markup are both
// present in the initial document, we inject them at the Vercel edge for
// the /warriorplus route only.
//
// Scope guarantees:
//   • Matcher restricts this middleware to exactly one path: /warriorplus.
//   • No other route's HTML is touched.
//   • Idempotent: if either tag is already present in the upstream HTML,
//     we pass it through unmodified and only inject what is missing.
//   • The injected Sales Page Code is byte-for-byte identical to the
//     script WarriorPlus expects to find:
//
//       <script type="text/javascript"
//               src="https://warriorplus.com/o2/js/qg7sz4"
//               defer></script>
//
//   • The injected Buy Button markup is byte-for-byte identical to the
//     official hoplink + button image WarriorPlus expects to find:
//
//       <a href="https://warriorplus.com/o2/buy/k03rn0/qg7sz4/d144t7">
//         <img src="https://warriorplus.com/o2/btn/fn100011001/k03rn0/qg7sz4/468109">
//       </a>
//
//   • Both placed immediately before </body>, the canonical pre-</body> slot.
//   • Existing scripts (Cloudflare beacon, /sw.js registration, etc.)
//     are left untouched.
//
// If this edge function ever fails, the client-side React fallback
// (<WarriorPlusSalesScript />) still injects the same Sales Page Code via
// useEffect using the same idempotency guard. The React-rendered Buy
// Button inside <PricingCard /> also covers the Buy Button fallback.
// Defense in depth.
// ─────────────────────────────────────────────────────────────────────────

export const config = {
  // Only run for the production WarriorPlus landing page.
  matcher: "/warriorplus",
};

// MUST remain byte-identical to the WarriorPlus-mandated Sales Page Code.
const WARRIORPLUS_SCRIPT_TAG =
  '<script type="text/javascript" src="https://warriorplus.com/o2/js/qg7sz4" defer></script>';

// Stable marker used for idempotency / diagnostics (Sales Page Code).
const WARRIORPLUS_MARKER = "warriorplus.com/o2/js/qg7sz4";

// MUST remain byte-identical to the WarriorPlus-mandated Buy Button markup.
// The same string is also rendered by React via dangerouslySetInnerHTML
// inside <PricingCard /> so the visible button sits inside the pricing
// card. The page-level useEffect in WarriorPlusPage removes the edge copy
// post-hydration so the final DOM contains exactly one anchor.
const WARRIORPLUS_BUY_BUTTON_TAG =
  '<a href="https://warriorplus.com/o2/buy/k03rn0/qg7sz4/d144t7"><img src="https://warriorplus.com/o2/btn/fn100011001/k03rn0/qg7sz4/468109"></a>';

// Stable marker used for idempotency / diagnostics (Buy Button).
const WARRIORPLUS_BUY_BUTTON_MARKER =
  "warriorplus.com/o2/buy/k03rn0/qg7sz4";

export default async function middleware(request: Request): Promise<Response> {
  // Fetch the SPA shell directly (the SPA rewrite in vercel.json collapses
  // every non-API route to /index.html). Fetching the static file by path
  // avoids any chance of re-entering this middleware.
  const indexUrl = new URL("/index.html", request.url);
  const upstream = await fetch(indexUrl.toString(), {
    headers: request.headers,
  });

  const html = await upstream.text();

  const hasScript = html.includes(WARRIORPLUS_MARKER);
  const hasBuyButton = html.includes(WARRIORPLUS_BUY_BUTTON_MARKER);

  // ── Idempotency guard ──────────────────────────────────────────────
  // If both compliance tags are already in the document, return as-is.
  // This protects against any future build step that might also inject
  // them.
  if (hasScript && hasBuyButton) {
    return new Response(html, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers,
    });
  }

  // ── Inject immediately before </body> ──────────────────────────────
  // If </body> is missing (shouldn't happen for our SPA), return as-is.
  if (!html.includes("</body>")) {
    return new Response(html, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers,
    });
  }

  let modifiedHtml = html;
  if (!hasScript) {
    modifiedHtml = modifiedHtml.replace(
      "</body>",
      `${WARRIORPLUS_SCRIPT_TAG}</body>`,
    );
  }
  if (!hasBuyButton) {
    modifiedHtml = modifiedHtml.replace(
      "</body>",
      `${WARRIORPLUS_BUY_BUTTON_TAG}</body>`,
    );
  }

  return new Response(modifiedHtml, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
