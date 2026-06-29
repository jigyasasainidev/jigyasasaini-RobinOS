// Official JVZoo tracking pixel URL. Centralized so future updates require
// changing only this constant.
const JVZOO_TRACKING_PIXEL_URL = "https://i.jvzoo.com/0/442467/99";

/**
 * Invisible JVZoo tracking pixel.
 *
 * Mount this once on a page where JVZoo conversions should be tracked. It
 * renders a 1x1 image with no styling and no business logic — purely a
 * fire-and-forget tracking beacon.
 */
export function JVZooTrackingPixel() {
  return (
    <img
      src={JVZOO_TRACKING_PIXEL_URL}
      width={1}
      height={1}
      alt=""
      aria-hidden="true"
    />
  );
}
