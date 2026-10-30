import { memo, useCallback, useRef, useState } from "react";

interface Props {
  /** Visual (scaled) width of the master canvas in CSS px. */
  canvasWidth: number;
  /** Current horizontal margin, as a % of the master canvas width. */
  marginH: number;
  /** Distance from the top of the viewport (e.g. toolbar height) in px. */
  topOffset?: number;
  /** Hard cap for the margin percentage. */
  max?: number;
  /** Snap handle drags to the ruler tick marks (hold Alt to bypass). */
  snap?: boolean;
  onChange: (next: number) => void;
}

/** Ruler shows 21 ticks across the canvas, i.e. one every 5%. */
const TICK_STEP = 5;

/** Fire a short haptic pulse if the device supports it. */
const haptic = (ms: number | number[] = 8) => {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
  } catch { /* no-op */ }
};

/**
 * Word-style margin ruler pinned to the top of Edit Mode. Dragging either
 * handle sets the symmetric horizontal margin (a % of the fixed master canvas)
 * so the text column can be sized by eye instead of via the settings slider.
 */
function MarginRulerImpl({ canvasWidth, marginH, max = 45, topOffset = 0, snap = false, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const lastTickPct = useRef(-1);

  const apply = useCallback(
    (side: "left" | "right", clientX: number, rect: DOMRect, fine: boolean) => {
      const x = clientX - rect.left;
      const raw = side === "left" ? (x / rect.width) * 100 : ((rect.width - x) / rect.width) * 100;
      // Alt temporarily disables snapping for fine adjustments.
      const pct = snap && !fine ? Math.round(raw / TICK_STEP) * TICK_STEP : raw;
      const next = Math.round(Math.min(max, Math.max(0, pct)));
      // Haptic tick: buzz whenever the snapped value crosses a tick boundary.
      if (snap && !fine) {
        const snapped = Math.round(next / TICK_STEP) * TICK_STEP;
        if (snapped !== lastTickPct.current) {
          lastTickPct.current = snapped;
          haptic(6);
        }
      }
      onChange(next);
    },
    [max, onChange, snap],
  );

  const beginDrag = useCallback((side: "left" | "right") => {
    setDragging(side);
    lastTickPct.current = -1;
    haptic(12);
  }, []);

  const endDrag = useCallback(() => {
    setDragging(null);
    haptic(5);
  }, []);

  const drag = useCallback(
    (side: "left" | "right") => (e: React.PointerEvent) => {
      e.preventDefault();
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      beginDrag(side);
      const move = (ev: PointerEvent) => apply(side, ev.clientX, rect, ev.altKey);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        endDrag();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [apply, beginDrag, endDrag],
  );

  /** Touch equivalent of the pointer drag — mirrors the same math using
   *  `e.touches[0].clientX` so the handles work on phones and tablets. */
  const touchDrag = useCallback(
    (side: "left" | "right") => (e: React.TouchEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const t = e.touches[0];
      if (t) apply(side, t.clientX, rect, false);
    },
    [apply],
  );

  const ticks = [];
  for (let i = 0; i <= 20; i++) {
    ticks.push(
      <div
        key={i}
        className="absolute bottom-0 bg-[#3a3a3a]"
        style={{ left: `${(i / 20) * 100}%`, width: 1, height: i % 5 === 0 ? 10 : 5 }}
      />,
    );
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center"
      style={{ top: topOffset }}
    >
      <div
        ref={trackRef}
        className={`pointer-events-auto relative h-6 border-b transition-colors duration-150 bg-[#0d0d0d]/90 backdrop-blur ${dragging ? "border-[#0055ff]" : "border-[#242424]"}`}
        style={{ width: canvasWidth }}
      >
        {ticks}
        {/* Margin gutters — brighten the active side while dragging */}
        <div
          className="absolute inset-y-0 left-0 transition-colors duration-150"
          style={{
            width: `${marginH}%`,
            background: dragging === "left" ? "rgba(0,85,255,0.28)" : "#1b1b1b",
          }}
        />
        <div
          className="absolute inset-y-0 right-0 transition-colors duration-150"
          style={{
            width: `${marginH}%`,
            background: dragging === "right" ? "rgba(0,85,255,0.28)" : "#1b1b1b",
          }}
        />

        {/* Floating percentage badge shown while a handle is active */}
        {dragging && (
          <div
            className="pointer-events-none absolute -top-7 z-40 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white shadow-lg"
            style={{
              background: "#0055ff",
              left: dragging === "left" ? `${marginH}%` : "auto",
              right: dragging === "right" ? `${marginH}%` : "auto",
              transform: "translateX(-50%)",
            }}
          >
            {marginH}%
          </div>
        )}

        {(["left", "right"] as const).map((side) => {
          const active = dragging === side;
          return (
            <div
              key={side}
              role="slider"
              aria-label={`${side} margin`}
              aria-valuenow={marginH}
              aria-valuemin={0}
              aria-valuemax={max}
              tabIndex={0}
              onPointerDown={drag(side)}
              onTouchStart={(e) => { e.preventDefault(); beginDrag(side); touchDrag(side)(e); }}
              onTouchMove={(e) => { e.preventDefault(); touchDrag(side)(e); }}
              onTouchEnd={(e) => { e.preventDefault(); endDrag(); }}
              onKeyDown={(e) => {
                const step = snap && !e.altKey ? TICK_STEP : 1;
                if (e.key === "ArrowLeft") onChange(Math.max(0, marginH - step));
                if (e.key === "ArrowRight") onChange(Math.min(max, marginH + step));
              }}
              title={snap ? "Drag to set margin (snaps to ticks — hold Alt for fine control)" : "Drag to set margin"}
              className={`absolute top-0 h-full w-6 cursor-col-resize touch-none transition-transform duration-100 md:w-3 ${active ? "scale-125" : "scale-100"}`}
              style={{ [side]: `${marginH}%`, touchAction: "none", transform: side === "left" ? `translateX(-50%) ${active ? "scale(1.25)" : ""}` : `translateX(50%) ${active ? "scale(1.25)" : ""}` } as React.CSSProperties}
            >
              <div
                className={`mx-auto mt-1 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent transition-colors duration-100 ${active ? "border-t-white" : "border-t-[#0055ff]"}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}


export const MarginRuler = memo(MarginRulerImpl);
