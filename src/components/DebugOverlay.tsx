import { useEffect, useRef, useState } from "react";

/**
 * Tiny in-app HUD showing FPS + input latency. Toggle with Cmd/Ctrl+Shift+D
 * or by loading any URL with `?debug=1`. Purely local, never networked.
 *
 * FPS: measured from requestAnimationFrame timestamps (1s rolling window).
 * Input latency: time between the last keydown/scroll event and the next
 * animation frame — i.e. how long the main thread was busy before the UI
 * could respond.
 */
export function DebugOverlay() {
  const [visible, setVisible] = useState(false);
  const [fps, setFps] = useState(0);
  const [keyLat, setKeyLat] = useState(0);
  const [scrollLat, setScrollLat] = useState(0);

  useEffect(() => {
    try {
      if (new URL(window.location.href).searchParams.get("debug") === "1") {
        setVisible(true);
      }
    } catch {}
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.code === "KeyD" || e.key === "D" || e.key === "d")) {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    let frames = 0;
    let lastFpsAt = performance.now();
    let pendingKeyAt: number | null = null;
    let pendingScrollAt: number | null = null;

    const onKey = () => {
      pendingKeyAt = performance.now();
    };
    const onScroll = () => {
      if (pendingScrollAt == null) pendingScrollAt = performance.now();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", onScroll, { capture: true, passive: true });
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });

    const tick = (now: number) => {
      frames++;
      if (now - lastFpsAt >= 500) {
        setFps(Math.round((frames * 1000) / (now - lastFpsAt)));
        frames = 0;
        lastFpsAt = now;
      }
      if (pendingKeyAt != null) {
        setKeyLat(Math.round(now - pendingKeyAt));
        pendingKeyAt = null;
      }
      if (pendingScrollAt != null) {
        setScrollLat(Math.round(now - pendingScrollAt));
        pendingScrollAt = null;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", onScroll, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [visible]);

  if (!visible) return null;
  const fpsColor = fps >= 55 ? "#4ade80" : fps >= 30 ? "#fbbf24" : "#f87171";
  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        left: 8,
        zIndex: 2147483647,
        pointerEvents: "none",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.35,
        padding: "6px 8px",
        borderRadius: 6,
        background: "rgba(0,0,0,0.75)",
        color: "#f5f5f5",
        border: "1px solid #333",
        minWidth: 130,
      }}
      aria-hidden
    >
      <div style={{ color: "#a3a3a3", letterSpacing: ".08em" }}>TRS-1 DEBUG</div>
      <div>FPS: <span style={{ color: fpsColor, fontWeight: 600 }}>{fps}</span></div>
      <div>Key latency: {keyLat} ms</div>
      <div>Scroll latency: {scrollLat} ms</div>
      <div style={{ color: "#737373", marginTop: 4 }}>⌘⇧D to toggle</div>
    </div>
  );
}
