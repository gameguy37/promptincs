import { useEffect, useRef, useState } from "react";
import { X, Pencil, GripVertical } from "lucide-react";

export interface PipConfig {
  enabled: boolean;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  bgColor: string;
  textColor: string;
  /** 0..1 — background/border/text opacity multiplier. Persisted. */
  opacity?: number;
  /** Uniform scale multiplier applied via CSS transform. Persisted. */
  scale?: number;
  /** Hide the drag/edit chrome (useful in prompt mode for a clean look). */
  locked?: boolean;
}

export const defaultPipConfig: PipConfig = {
  enabled: false,
  text: "You're in Atlantic City, NJ! 🎤",
  x: -1, // -1 = auto place top-right on first mount
  y: 16,
  w: 320,
  h: 96,
  fontSize: 22,
  bgColor: "#141414",
  textColor: "#ffffff",
  opacity: 1,
  scale: 1,
  locked: false,
};

interface Props {
  config: PipConfig;
  onChange: (patch: Partial<PipConfig>) => void;
  /** When true, only text is shown — no chrome, no interactions. */
  readOnly?: boolean;
}

/**
 * Static picture-in-picture reminder card. Draggable + resizable, edits
 * its own text in place. Rendered above the prompter so the performer can
 * glance at a persistent cue ("You're in Atlantic City, NJ!").
 */
export function StagePip({ config, onChange, readOnly = false }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ w: number; h: number; x: number; y: number } | null>(null);

  // Auto-place top-right on first mount when x === -1.
  useEffect(() => {
    if (config.x === -1 && typeof window !== "undefined") {
      onChange({ x: Math.max(16, window.innerWidth - config.w - 16) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        onChange({
          x: Math.max(0, e.clientX - dragRef.current.dx),
          y: Math.max(0, e.clientY - dragRef.current.dy),
        });
      } else if (resizeRef.current) {
        const r = resizeRef.current;
        onChange({
          w: Math.max(120, r.w + (e.clientX - r.x)),
          h: Math.max(48, r.h + (e.clientY - r.y)),
        });
      }
    };
    const onUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onChange]);

  if (!config.enabled) return null;

  const chrome = !readOnly && !config.locked;
  const opacity = typeof config.opacity === "number" ? Math.max(0, Math.min(1, config.opacity)) : 1;
  const scale = typeof config.scale === "number" ? Math.max(0.4, Math.min(3, config.scale)) : 1;

  return (
    <div
      ref={rootRef}
      className="fixed z-50 flex flex-col overflow-hidden rounded-md border border-[#2a2a2a] shadow-2xl"
      style={{
        left: Math.max(0, config.x),
        top: config.y,
        width: config.w,
        height: config.h,
        backgroundColor: config.bgColor,
        color: config.textColor,
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        pointerEvents: "auto",
      }}
      aria-label="Stage cue"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange({ enabled: false });
      }}
    >
      {chrome && (
        <div
          className="flex h-5 shrink-0 items-center justify-between border-b border-[#2a2a2a] bg-black/40 px-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-400"
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest("[data-pip-action]")) return;
            e.preventDefault();
            dragRef.current = { dx: e.clientX - config.x, dy: e.clientY - config.y };
          }}
          style={{ cursor: "move" }}
        >
          <span className="flex items-center gap-1">
            <GripVertical className="h-3 w-3" /> Cue
          </span>
          <span className="flex items-center gap-0.5">
            <button
              data-pip-action
              type="button"
              className="rounded p-0.5 hover:bg-white/10"
              onClick={() => setEditing((v) => !v)}
              aria-label="Edit cue text"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              data-pip-action
              type="button"
              className="rounded p-0.5 hover:bg-white/10"
              onClick={() => onChange({ enabled: false })}
              aria-label="Close cue"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}
      {editing && chrome ? (
        <textarea
          autoFocus
          value={config.text}
          onChange={(e) => onChange({ text: e.target.value })}
          onBlur={() => setEditing(false)}
          className="flex-1 resize-none bg-transparent p-2 outline-none"
          style={{ fontSize: config.fontSize, color: config.textColor }}
        />
      ) : (
        <div
          className="flex flex-1 items-center justify-center px-3 py-2 text-center leading-tight"
          style={{ fontSize: config.fontSize }}
          onDoubleClick={() => chrome && setEditing(true)}
        >
          {config.text}
        </div>
      )}
      {chrome && (
        <div
          data-pip-action
          className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.4) 50%)",
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            resizeRef.current = { w: config.w, h: config.h, x: e.clientX, y: e.clientY };
          }}
        />
      )}
    </div>
  );
}