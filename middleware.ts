// ─────────────────────────────────────────────────────────────────────────
// WARRIORPLUS COMPLIANCE — EDGE MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────
// WarriorPlus marketplace compliance scanners inspect the *raw HTML*
// response (View Source), not the post-hydration DOM. To guarantee the
// official Sales Page Code is present in the initial document, we inject
// it at the Vercel edge for the /warriorplus route only.
//
// Scope guarantees:
//   • Matcher restricts this middleware to exactly one path: /warriorplus.
//   • No other route's HTML is touched.
//   • Idempotent: if the tag is already present in the upstream HTML,
//     we pass it through unmodified.
//   • The injected markup is byte-for-byte identical to the script
//     WarriorPlus expects to find:
//
//       <script type="text/javascript"
//               src="https://warriorplus.com/o2/js/qg7sz4"
//               defer></script>
//
//   • Placed immediately before </body>, the canonical pre-</body> slot.
//   • Existing scripts (Cloudflare beacon, /sw.js registration, etc.)
//     are left untouched.
//
// If this edge function ever fails, the client-side React fallback
// (<WarriorPlusSalesScript />) still injects the same tag via useEffect
// using the same idempotency guard. Defense in depth.
// ─────────────────────────────────────────────────────────────────────────

export const config = {
  // Only run for the production WarriorPlus landing page.
  matcher: "/warriorplus",
};

// MUST remain byte-identical to the WarriorPlus-mandated Sales Page Code.
const WARRIORPLUS_SCRIPT_TAG =
  '<script type="text/javascript" src="https://warriorplus.com/o2/js/qg7sz4" defer></script>';

// Stable marker used for idempotency / diagnostics.
const WARRIORPLUS_MARKER = "warriorplus.com/o2/js/qg7sz4";

export default async function middleware(request: Request): Promise<Response> {
  // Fetch the SPA shell directly (the SPA rewrite in vercel.json collapses
  // every non-API route to /index.html). Fetching the static file by path
  // avoids any chance of re-entering this middleware.
  const indexUrl = new URL("/index.html", request.url);
  const upstream = await fetch(indexUrl.toString(), {
    headers: request.headers,
  });

  const html = await upstream.text();

  // ── Idempotency guard ──────────────────────────────────────────────
  // If the script tag is already in the document, return as-is. This
  // protects against any future build step that might also inject it.
  if (html.includes(WARRIORPLUS_MARKER)) {
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

  const modifiedHtml = html.replace(
    "</body>",
    `${WARRIORPLUS_SCRIPT_TAG}</body>`,
  );

  return new Response(modifiedHtml, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
