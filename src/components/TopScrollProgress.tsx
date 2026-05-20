import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

export function TopScrollProgress() {
  const lineRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const currentProgressRef = useRef(0);
  const targetProgressRef = useRef(0);
  const isAnimatingRef = useRef(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const el = lineRef.current;
    if (!el) return;

    const animateToTarget = () => {
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop || 0;
      const maxScroll = Math.max(doc.scrollHeight - window.innerHeight, 0);

      targetProgressRef.current = maxScroll > 0 ? Math.min(scrollTop / maxScroll, 1) : 0;
      currentProgressRef.current += (targetProgressRef.current - currentProgressRef.current) * 0.18;

      if (Math.abs(targetProgressRef.current - currentProgressRef.current) < 0.001) {
        currentProgressRef.current = targetProgressRef.current;
      }

      el.style.transform = `scaleX(${currentProgressRef.current})`;
      el.style.opacity = maxScroll > 0 ? "1" : "0";

      if (currentProgressRef.current !== targetProgressRef.current) {
        rafRef.current = window.requestAnimationFrame(animateToTarget);
        return;
      }

      rafRef.current = null;
      isAnimatingRef.current = false;
    };

    const requestUpdate = () => {
      if (isAnimatingRef.current) return;
      isAnimatingRef.current = true;
      rafRef.current = window.requestAnimationFrame(animateToTarget);
    };

    const onScroll = requestUpdate;
    const onResize = requestUpdate;

    currentProgressRef.current = 0;
    targetProgressRef.current = 0;
    el.style.transform = "scaleX(0)";
    el.style.opacity = "0";

    const initFrame = window.requestAnimationFrame(() => {
      requestUpdate();
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.cancelAnimationFrame(initFrame);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      isAnimatingRef.current = false;
    };
  }, [pathname]);

  return (
    <div className="scroll-progress-root" aria-hidden="true">
      <div ref={lineRef} className="scroll-progress-line" />
    </div>
  );
}
