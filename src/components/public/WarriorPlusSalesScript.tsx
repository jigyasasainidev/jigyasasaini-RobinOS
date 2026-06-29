import { useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────
// WARRIORPLUS OFFICIAL SALES PAGE SCRIPT
// ─────────────────────────────────────────────────────────────────────────
// Required compliance / tracking integration issued by the WarriorPlus
// marketplace. This MUST be loaded on every approved sales page so the
// marketplace can attribute impressions, clicks, and conversions back to
// the vendor account.
//
// Scope of this component:
//   • Loads ONLY when mounted (i.e. on /warriorplus).
//   • Injects the script via document.body.appendChild inside useEffect.
//   • Uses a stable, unique element id so re-mounts never create duplicates.
//   • Cleans the element up on unmount so navigating away removes it.
//   • Renders nothing in the React tree.
//
// Not loaded: homepage, /jvzoo, /dashboard, /admin, or any other route.
// ─────────────────────────────────────────────────────────────────────────

const WARRIORPLUS_SALES_SCRIPT_ID = "warriorplus-sales-script";
const WARRIORPLUS_SALES_SCRIPT_SRC = "https://warriorplus.com/o2/js/qg7sz4";

/**
 * Invisible compliance / tracking injector for the official WarriorPlus
 * sales page script.
 *
 * Mount this component once inside the sales page layout (e.g. at the
 * bottom of <WarriorPlusPage />). It renders nothing visible — its only
 * job is to append the marketplace tracking script to <body> on mount and
 * remove it on unmount.
 */
export function WarriorPlusSalesScript() {
  useEffect(() => {
    // Idempotency guard: if a script with our id already exists (e.g. from
    // a previous mount, an HMR reload, or a parent layout), do nothing.
    if (document.getElementById(WARRIORPLUS_SALES_SCRIPT_ID)) {
      return;
    }

    const script = document.createElement("script");
    script.id = WARRIORPLUS_SALES_SCRIPT_ID;
    script.type = "text/javascript";
    script.src = WARRIORPLUS_SALES_SCRIPT_SRC;
    script.defer = true;
    document.body.appendChild(script);

    // Cleanup: remove the injected script when the component unmounts so
    // navigating away from /warriorplus tears the tracker back down.
    return () => {
      const existing = document.getElementById(WARRIORPLUS_SALES_SCRIPT_ID);
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
    };
  }, []);

  return null;
}
