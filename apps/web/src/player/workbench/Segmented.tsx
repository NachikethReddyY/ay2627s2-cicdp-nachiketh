import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react";

/**
 * A group of buttons whose selected one (aria-pressed="true") gets one shared bubble that slides to it
 * (workbench.css, [data-slider]). The bubble's position comes from the selected button's box, measured after
 * every render and on resize, so it follows reflow. The first placement does not animate.
 */
export default function Segmented({ className = "", ...rest }: ComponentPropsWithoutRef<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
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
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    const raf = requestAnimationFrame(() => (el.dataset.moving = ""));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  });
  return <div ref={ref} data-slider="" className={className} {...rest} />;
}
