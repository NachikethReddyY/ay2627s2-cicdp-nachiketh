import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react";

/**
 * A group of buttons whose selected one (aria-pressed="true") gets one shared bubble that slides to it
 * (workbench.css, [data-slider]). The bubble's position comes from the selected button's box, measured after
 * every render and on resize, so it follows reflow. The first placement does not animate.
 */
export default function Segmented({ className = "", ...rest }: ComponentPropsWithoutRef<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  const place = useRef<() => void>(() => {});
  const last = useRef(-2);
  // Mount only: re-place when the group resizes, and start animating after the first placement.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    place.current = () => {
      const on = el.querySelector<HTMLElement>(':scope > [aria-pressed="true"]');
      if (!on) {
        el.style.setProperty("--so", "0");
        return;
      }
      el.style.setProperty("--sx", `${on.offsetLeft}px`);
      el.style.setProperty("--sy", `${on.offsetTop}px`);
      el.style.setProperty("--sw", `${on.offsetWidth}px`);
      el.style.setProperty("--sh", `${on.offsetHeight}px`);
      el.style.setProperty("--sr", getComputedStyle(on).borderRadius);
      el.style.setProperty("--so", "1");
    };
    const ro = new ResizeObserver(() => place.current());
    ro.observe(el);
    const raf = requestAnimationFrame(() => (el.dataset.moving = ""));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);
  // Every render: a cheap look at which button is selected; measure only when that changes.
  useLayoutEffect(() => {
    const kids = [...(ref.current?.children ?? [])];
    const at = kids.findIndex((k) => k.getAttribute("aria-pressed") === "true");
    if (at === last.current) return;
    last.current = at;
    place.current();
  });
  return <div ref={ref} data-slider="" className={className} {...rest} />;
}
