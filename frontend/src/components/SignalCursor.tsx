import { useEffect, useRef } from "react";
import { pointerMotion } from "../lib/motion";

/** Pointer samples stay in closures. Only transforms are written in the RAF. */
export default function SignalCursor() {
  const core = useRef<HTMLDivElement>(null);
  const echo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const policy = matchMedia(
      "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );
    let dispose = () => {};
    const configure = () => {
      dispose();
      if (!policy.matches) return;
      const dot = core.current!,
        ring = echo.current!;
      const field = document.querySelector<HTMLElement>(".signal-atmosphere");
      let x = 0,
        y = 0,
        ex = 0,
        ey = 0,
        frame = 0,
        last = 0;
      let visible = false,
        interactive = false,
        size = 1;
      let attracted = false;
      let target: HTMLElement | null = null;
      let rect: DOMRect | null = null;
      let mx = 0,
        my = 0,
        tx = 0,
        ty = 0;
      const resetTarget = () => {
        if (target) target.style.translate = "";
        target = null;
        rect = null;
        mx = my = tx = ty = 0;
      };
      const draw = (now: number) => {
        frame = 0;
        if (!visible || document.hidden) return;
        const dt = Math.min(32, now - (last || now - 16));
        last = now;
        const blend = 1 - Math.exp(-dt / pointerMotion.followMs);
        ex += (x - ex) * blend;
        ey += (y - ey) * blend;
        size += ((interactive ? 1.45 : 1) - size) * blend;
        const dx = x - ex,
          dy = y - ey;
        const lag = Math.min(Math.hypot(dx, dy) / 180, 0.35);
        dot.style.transform = `translate3d(${x}px,${y}px,0)`;
        ring.style.transform = `translate3d(${ex}px,${ey}px,0) rotate(${Math.atan2(dy, dx)}rad) scale(${size + lag},${size - lag * 0.35})`;
        mx += (tx - mx) * blend;
        my += (ty - my) * blend;
        if (target) target.style.translate = `${mx}px ${my}px`;
        if (target && !attracted && Math.abs(mx) + Math.abs(my) < 0.05)
          resetTarget();
        if (field)
          field.style.translate = `${(x / innerWidth - 0.5) * 8}px ${(y / innerHeight - 0.5) * 6}px`;
        if (
          Math.abs(dx) +
            Math.abs(dy) +
            Math.abs(size - (interactive ? 1.45 : 1)) +
            Math.abs(tx - mx) +
            Math.abs(ty - my) >
          0.05
        )
          frame = requestAnimationFrame(draw);
      };
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(draw);
      };
      const hide = () => {
        visible = false;
        dot.style.opacity = ring.style.opacity = "0";
        document.documentElement.classList.remove("signal-pointer");
        cancelAnimationFrame(frame);
        frame = 0;
        last = 0;
        resetTarget();
      };
      const move = (e: PointerEvent) => {
        if (e.pointerType !== "mouse") {
          hide();
          return;
        }
        x = e.clientX;
        y = e.clientY;
        if (!visible) {
          ex = x;
          ey = y;
          visible = true;
        }
        const element = e.target instanceof Element ? e.target : null;
        const control = element?.closest<HTMLElement>(
          "button:enabled, a, summary, input",
        );
        // Keep native I-beams, sliders, and checkboxes intact.
        const native = Boolean(
          element?.closest("input, textarea, [contenteditable=true]"),
        );
        document.documentElement.classList.toggle("signal-pointer", !native);
        dot.style.opacity = native ? "0" : "1";
        ring.style.opacity = native ? "0" : control ? "0.75" : "0.35";
        interactive = Boolean(control);
        const magnetic = control?.matches("[data-magnetic]") ? control : null;
        attracted = Boolean(magnetic);
        if (magnetic && magnetic !== target) {
          resetTarget();
          target = magnetic;
          rect = target.getBoundingClientRect();
        }
        if (magnetic && rect) {
          tx = Math.max(
            -pointerMotion.maxAttraction,
            Math.min(
              pointerMotion.maxAttraction,
              (x - rect.left - rect.width / 2) * pointerMotion.attraction,
            ),
          );
          ty = Math.max(
            -pointerMotion.maxAttraction,
            Math.min(
              pointerMotion.maxAttraction,
              (y - rect.top - rect.height / 2) * pointerMotion.attraction,
            ),
          );
        } else tx = ty = 0;
        schedule();
      };
      const leave = (e: PointerEvent) => {
        if (!e.relatedTarget) hide();
      };
      const visibility = () => {
        if (document.hidden) hide();
      };
      // Geometry is refreshed on the next pointer sample after a scroll/resize.
      const geometry = () => {
        resetTarget();
      };
      document.addEventListener("pointermove", move, { passive: true });
      document.addEventListener("pointerout", leave);
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("blur", hide);
      window.addEventListener("scroll", geometry, {
        passive: true,
        capture: true,
      });
      window.addEventListener("resize", geometry);
      dispose = () => {
        hide();
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerout", leave);
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("blur", hide);
        window.removeEventListener("scroll", geometry, true);
        window.removeEventListener("resize", geometry);
        if (field) field.style.translate = "";
      };
    };
    configure();
    policy.addEventListener("change", configure);
    return () => {
      dispose();
      policy.removeEventListener("change", configure);
    };
  }, []);
  return (
    <div className="cursor-layer" aria-hidden="true">
      <div ref={core} className="cursor-core" aria-hidden="true" />
      <div ref={echo} className="cursor-echo" aria-hidden="true" />
    </div>
  );
}
