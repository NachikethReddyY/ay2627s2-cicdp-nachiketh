import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react";

export default function Segmented({ className = "", ...rest }: ComponentPropsWithoutRef<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  const place = useRef<() => void>(() => {});
  const last = useRef(-2);
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
  useLayoutEffect(() => {
    const kids = [...(ref.current?.children ?? [])];
    const at = kids.findIndex((k) => k.getAttribute("aria-pressed") === "true");
    if (at === last.current) return;
    last.current = at;
    place.current();
  });
  return <div ref={ref} data-slider="" className={className} {...rest} />;
}
