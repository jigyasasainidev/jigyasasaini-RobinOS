// ─────────────────────────────────────────────────────────────────────────
// PLACEHOLDER — TRACKING PIXEL NOT WIRED UNTIL WARRIORPLUS APPROVAL
// ─────────────────────────────────────────────────────────────────────────
// Once the RobinOS product is approved on the WarriorPlus marketplace, a
// unique 1x1 pixel URL is issued for conversion tracking. Insert that URL
// in place of the empty string below and this component will fire a
// fire-and-forget beacon on every /warriorplus page render.
//
// Until then the component renders nothing — visitors are still tracked
// through the global Endorsely script injected by PublicLayout.
// ─────────────────────────────────────────────────────────────────────────
const WARRIORPLUS_TRACKING_PIXEL_URL = "";

/**
 * Invisible WarriorPlus tracking pixel.
 *
 * Mount this once on a page where WarriorPlus conversions should be
 * tracked. It renders a 1x1 image with no styling and no business logic —
 * purely a fire-and-forget tracking beacon.
 *
 * When WARRIORPLUS_TRACKING_PIXEL_URL is empty (pre-approval), this
 * component renders nothing at all.
 */
export function WarriorPlusTrackingPixel() {
  if (!WARRIORPLUS_TRACKING_PIXEL_URL) return null;
  return (
    <img
      src={WARRIORPLUS_TRACKING_PIXEL_URL}
      width={1}
      height={1}
      alt=""
      aria-hidden="true"
    />
  );
}
