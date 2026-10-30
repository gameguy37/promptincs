import { memo, useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";

export interface OperatorHUDProps {
  /** Plain text of the whole script — drives word count / read time. */
  scriptText: string;
  /** Current scroll velocity. The elapsed timer runs while this is non-zero. */
  speed: number;
  /** Scroll progress 0..1. */
  progress: number;
  /** Words-per-minute used for the read-time estimate. */
  wpm?: number;
  /** Controlled visibility (the `H` key toggles this from the host app). */
  visible?: boolean;
  /** Called when the operator hides (double-click) or restores (eye) the HUD. */
  onVisibleChange?: (visible: boolean) => void;
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function countWords(text: string): number {
  const trimmed = (text || "").trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Operator HUD — a fixed overlay that ONLY ever renders on the host/operator
 * screen. The talent's pop-out viewer must stay clean glass, so callers gate
 * this behind `!displayOnly`.
 */
function OperatorHUDImpl({
  scriptText,
  speed,
  progress,
  wpm = 150,
  visible = true,
  onVisibleChange,
}: OperatorHUDProps) {
  const [elapsed, setElapsed] = useState(0);
  const runningSince = useRef<number | null>(null);
  const accumulated = useRef(0);

  // The clock runs only while the script is actually moving.
  useEffect(() => {
    if (speed !== 0 && runningSince.current === null) {
      runningSince.current = Date.now();
    } else if (speed === 0 && runningSince.current !== null) {
      accumulated.current += Date.now() - runningSince.current;
      runningSince.current = null;
    }
  }, [speed]);

  useEffect(() => {
    const id = setInterval(() => {
      const live = runningSince.current ? Date.now() - runningSince.current : 0;
      setElapsed(accumulated.current + live);
    }, 250);
    return () => clearInterval(id);
  }, []);

  const words = countWords(scriptText);
  const readMs = (words / Math.max(1, wpm)) * 60_000;
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  if (!visible) {
    return (
      <button
        type="button"
        aria-label="Show operator HUD"
        title="Show HUD (H)"
        onClick={() => onVisibleChange?.(true)}
        className="fixed bottom-2 right-2 z-[9999] rounded-sm border border-[#0055ff]/25 bg-black/60 p-1 text-[#4d8bff]/60 opacity-40 transition-opacity hover:opacity-100"
      >
        <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9999] select-none"
      data-operator-hud="true"
      aria-hidden="true"
      onDoubleClick={() => onVisibleChange?.(false)}
      title="Double-click to hide (H)"
    >
      <div className="mx-auto flex max-w-[900px] cursor-pointer items-center gap-4 rounded-t-md border border-b-0 border-[#0055ff]/40 bg-black/85 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-[#8fb4ff] backdrop-blur-sm">
        <span>
          <span className="text-[#4d8bff]">WORDS</span> {words.toLocaleString()}
        </span>
        <span>
          <span className="text-[#4d8bff]">READ</span> {fmt(readMs)}
        </span>
        <span>
          <span className="text-[#4d8bff]">ELAPSED</span>{" "}
          <span className={speed !== 0 ? "text-white" : undefined}>{fmt(elapsed)}</span>
        </span>
        <span>
          <span className="text-[#4d8bff]">SPD</span> {speed.toFixed(1)}
        </span>
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#1a1a1a]">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[#0055ff] transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-9 text-right text-white">{pct}%</span>
      </div>
    </div>
  );
}

export const OperatorHUD = memo(OperatorHUDImpl);
export default OperatorHUD;