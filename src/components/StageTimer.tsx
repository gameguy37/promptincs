import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, X, ArrowUp, ArrowDown } from "lucide-react";

type TimerMode = "up" | "down";

/**
 * Stage Timer — a classic red LED 7-segment style clock to keep talent on pace.
 * - Count Up: elapsed time from 00:00.
 * - Count Down: from a user-set minutes:seconds; turns amber under 30s and
 *   blinks red at 00:00.
 * Fully self-contained: its own interval, cleaned up on unmount so it can never
 * leak during a live show.
 */
export function StageTimer({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<TimerMode>("up");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds, for count-up
  const [setMin, setSetMin] = useState(5);
  const [setSec, setSetSec] = useState(0);
  const [remaining, setRemaining] = useState(300); // seconds, for count-down
  const rafTarget = useRef<number | null>(null);

  // Single interval drives whichever mode is active.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (mode === "up") {
        setElapsed((e) => e + 1);
      } else {
        setRemaining((r) => Math.max(0, r - 1));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [running, mode]);

  // Stop automatically when a countdown hits zero.
  useEffect(() => {
    if (mode === "down" && remaining === 0 && running) setRunning(false);
  }, [mode, remaining, running]);

  const totalSetSeconds = setMin * 60 + setSec;

  const reset = useCallback(() => {
    setRunning(false);
    setElapsed(0);
    setRemaining(totalSetSeconds);
  }, [totalSetSeconds]);

  const start = useCallback(() => {
    if (mode === "down" && remaining === 0) setRemaining(totalSetSeconds);
    setRunning((r) => !r);
  }, [mode, remaining, totalSetSeconds]);

  const value = mode === "up" ? elapsed : remaining;
  const mm = String(Math.floor(value / 60)).padStart(2, "0");
  const ss = String(value % 60).padStart(2, "0");

  const danger = mode === "down" && remaining <= 30;
  const expired = mode === "down" && remaining === 0;
  const color = expired ? "#ff2a2a" : danger ? "#ffae00" : "#ff3b30";

  // Apply a fresh countdown target whenever the user edits min/sec while idle.
  useEffect(() => {
    if (!running && mode === "down") setRemaining(totalSetSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalSetSeconds, mode]);

  void rafTarget;

  return (
    <div className="fixed left-4 top-16 z-50 w-[230px] select-none rounded-md border border-[#2a2a2a] bg-[#0a0a0a]/95 p-3 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[#666]">
          Stage Timer
        </span>
        <button
          onClick={onClose}
          className="text-[#666] hover:text-white"
          title="Close timer"
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 7-segment LED readout */}
      <div
        className="mb-3 rounded-sm border border-[#1a1a1a] bg-black py-3 text-center"
        style={{ boxShadow: "inset 0 0 18px rgba(0,0,0,0.9)" }}
      >
        <span
          className={expired ? "animate-pulse" : undefined}
          style={{
            fontFamily: "'Courier New', monospace",
            fontWeight: 700,
            fontSize: "44px",
            letterSpacing: "4px",
            color,
            textShadow: `0 0 6px ${color}, 0 0 14px ${color}aa`,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {mm}:{ss}
        </span>
      </div>

      {/* Mode toggle */}
      <div className="mb-2 grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => {
            setMode("up");
            setRunning(false);
          }}
          className={`flex items-center justify-center gap-1 rounded-sm border px-2 py-1 text-[9px] uppercase tracking-wider ${
            mode === "up"
              ? "border-[#0055ff]/60 bg-[#0055ff]/15 text-[#4d8bff]"
              : "border-[#2a2a2a] bg-transparent text-[#888] hover:text-white"
          }`}
        >
          <ArrowUp className="h-3 w-3" /> Up
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("down");
            setRunning(false);
            setRemaining(totalSetSeconds);
          }}
          className={`flex items-center justify-center gap-1 rounded-sm border px-2 py-1 text-[9px] uppercase tracking-wider ${
            mode === "down"
              ? "border-[#0055ff]/60 bg-[#0055ff]/15 text-[#4d8bff]"
              : "border-[#2a2a2a] bg-transparent text-[#888] hover:text-white"
          }`}
        >
          <ArrowDown className="h-3 w-3" /> Down
        </button>
      </div>

      {/* Countdown setter */}
      {mode === "down" && (
        <div className="mb-2 flex items-center justify-center gap-1 text-[10px] text-[#888]">
          <input
            type="number"
            min={0}
            max={599}
            value={setMin}
            onChange={(e) => setSetMin(Math.max(0, Math.min(599, Number(e.target.value) || 0)))}
            className="h-7 w-12 rounded-sm border border-[#2a2a2a] bg-[#0c0c0c] text-center font-mono text-[#e5e5e5] outline-none focus:border-[#0055ff]/60"
          />
          <span className="text-[#555]">min</span>
          <input
            type="number"
            min={0}
            max={59}
            value={setSec}
            onChange={(e) => setSetSec(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
            className="h-7 w-12 rounded-sm border border-[#2a2a2a] bg-[#0c0c0c] text-center font-mono text-[#e5e5e5] outline-none focus:border-[#0055ff]/60"
          />
          <span className="text-[#555]">sec</span>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={start}
          className="flex flex-1 items-center justify-center gap-1 rounded-sm border border-[#2a2a2a] bg-[#1f1f1f] px-2 py-1.5 text-[10px] uppercase tracking-wider text-[#e5e5e5] hover:bg-[#2a2a2a]"
        >
          {running ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {running ? "Pause" : "Start"}
        </button>
        <button
          type="button"
          onClick={reset}
          className="flex items-center justify-center gap-1 rounded-sm border border-[#2a2a2a] bg-transparent px-2 py-1.5 text-[10px] uppercase tracking-wider text-[#888] hover:bg-[#1f1f1f] hover:text-white"
          title="Reset"
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      </div>
    </div>
  );
}
