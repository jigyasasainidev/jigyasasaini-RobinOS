/**
 * SmartLink — drop-in replacement for react-router <Link>
 *
 * Behavior:
 *   - Same route as current page → smooth scroll to top
 *   - Different route → normal navigation (Link default)
 *
 * Usage:
 *   <SmartLink to="/terms">Terms</SmartLink>
 *
 * It passes through all standard Link props (className, style,
 * onMouseEnter, etc.) so it's a zero-friction swap.
 */

import { Link, useLocation } from "react-router-dom";
import type { LinkProps } from "react-router-dom";

export function SmartLink({ to, onClick, children, ...rest }: LinkProps) {
  const { pathname } = useLocation();

  // Normalise both paths to strip trailing slashes for comparison
  const normalise = (p: string) => {
    const path = typeof p === "string" ? p : (p as { pathname?: string }).pathname ?? "";
    return path.replace(/\/+$/, "") || "/";
  };

  const isSamePage = normalise(String(to)) === normalise(pathname);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isSamePage) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    onClick?.(e);
  };

  return (
    <Link to={to} onClick={handleClick} {...rest}>
      {children}
    </Link>
  );
}
