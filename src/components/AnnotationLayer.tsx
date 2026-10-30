import { useCallback, useMemo, useRef, useState } from "react";

export type AnnotationTool = "off" | "pen" | "highlight" | "text" | "erase";

export interface Annotation {
  id: string;
  type: "pen" | "highlight" | "text";
  /** Block the annotation is anchored to, so it scrolls with the script. */
  blockId: string | null;
  /** Coordinates are canvas-space, relative to the anchor block's top. */
  x: number;
  y: number;
  points?: [number, number][];
  text?: string;
  color: string;
  size: number;
  author?: string;
}

export interface BlockOffset {
  top: number;
  height: number;
}

interface Props {
  /** Fixed master-canvas width (annotations live in this coordinate space). */
  width: number;
  /** Natural (unscaled) canvas height. */
  height: number;
  /** blockId -> unscaled offset within the canvas. */
  blockOffsets: Map<string, BlockOffset>;
  annotations: Annotation[];
  tool: AnnotationTool;
  color: string;
  size: number;
  opacity: number;
  /** Total transform scale applied to the canvas by the parent. */
  scale: number;
  author?: string;
  onAdd: (a: Annotation) => void;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  onRemove: (id: string) => void;
}

function newId() {
  return `an_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function toPath(points: [number, number][]) {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return `M ${first[0]} ${first[1]} ` + rest.map((p) => `L ${p[0]} ${p[1]}`).join(" ");
}

/**
 * Persistent annotation surface. Lives inside the fixed-width master canvas so
 * every mark scrolls, scales and wraps exactly with the script text. Strokes
 * are anchored to the block they were drawn over, which keeps them attached to
 * the right line even after the script above them is re-edited.
 */
export function AnnotationLayer({
  width,
  blockOffsets,
  annotations,
  tool,
  color,
  size,
  opacity,
  scale,
  author,
  onAdd,
  onUpdate,
  onRemove,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<Annotation | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const anchorFor = useCallback(
    (y: number): { blockId: string | null; top: number } => {
      let best: { blockId: string | null; top: number } = { blockId: null, top: 0 };
      let bestTop = -Infinity;
      for (const [id, off] of blockOffsets) {
        if (off.top <= y && off.top > bestTop) {
          bestTop = off.top;
          best = { blockId: id, top: off.top };
        }
      }
      return best;
    },
    [blockOffsets],
  );

  const topFor = useCallback(
    (blockId: string | null) => (blockId ? blockOffsets.get(blockId)?.top ?? 0 : 0),
    [blockOffsets],
  );

  const pointFromEvent = useCallback(
    (e: React.PointerEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const s = scale || 1;
      return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s };
    },
    [scale],
  );

  const interactive = tool !== "off";

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    if ((e.target as HTMLElement).closest("[data-annotation-note]")) return;
    const { x, y } = pointFromEvent(e);
    const anchor = anchorFor(y);

    if (tool === "text") {
      const note: Annotation = {
        id: newId(),
        type: "text",
        blockId: anchor.blockId,
        x,
        y: y - anchor.top,
        text: "",
        color,
        size: Math.max(16, size * 6),
        author,
      };
      onAdd(note);
      setEditingId(note.id);
      return;
    }
    if (tool === "erase") return;

    (e.target as Element).setPointerCapture?.(e.pointerId);
    const stroke: Annotation = {
      id: newId(),
      type: tool === "highlight" ? "highlight" : "pen",
      blockId: anchor.blockId,
      x: 0,
      y: 0,
      points: [[x, y - anchor.top]],
      color,
      size: tool === "highlight" ? size * 6 : size,
      author,
    };
    draftRef.current = stroke;
    setDraft(stroke);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const stroke = draftRef.current;
    if (!stroke) return;
    const { x, y } = pointFromEvent(e);
    const top = topFor(stroke.blockId);
    stroke.points = [...(stroke.points ?? []), [x, y - top]];
    setDraft({ ...stroke });
  };

  const endStroke = () => {
    const stroke = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!stroke || (stroke.points?.length ?? 0) < 2) return;
    onAdd(stroke);
  };

  const strokes = useMemo(
    () => annotations.filter((a) => a.type !== "text"),
    [annotations],
  );
  const notes = useMemo(() => annotations.filter((a) => a.type === "text"), [annotations]);

  return (
    <div
      ref={rootRef}
      data-annotation-layer
      className="absolute inset-0 z-30"
      style={{
        opacity,
        pointerEvents: interactive ? "auto" : "none",
        cursor: tool === "erase" ? "crosshair" : interactive ? "crosshair" : "default",
        touchAction: interactive ? "none" : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerLeave={endStroke}
    >
      <svg
        data-annotation-svg
        width="100%"
        height="100%"
        className="absolute left-0 top-0"
        style={{ overflow: "visible", pointerEvents: "none" }}
      >
        {strokes.map((a) => (
          <path
            key={a.id}
            d={toPath(a.points ?? [])}
            transform={`translate(0, ${topFor(a.blockId)})`}
            fill="none"
            stroke={a.color}
            strokeWidth={a.size}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={a.type === "highlight" ? 0.35 : 1}
            style={{ pointerEvents: tool === "erase" ? "stroke" : "none", cursor: "pointer" }}
            onPointerDown={(e) => {
              if (tool !== "erase") return;
              e.stopPropagation();
              onRemove(a.id);
            }}
          />
        ))}
        {draft && (
          <path
            d={toPath(draft.points ?? [])}
            transform={`translate(0, ${topFor(draft.blockId)})`}
            fill="none"
            stroke={draft.color}
            strokeWidth={draft.size}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={draft.type === "highlight" ? 0.35 : 1}
          />
        )}
      </svg>

      {notes.map((a) => (
        <div
          key={a.id}
          data-annotation-note
          className="absolute rounded-sm px-1 leading-tight"
          style={{
            left: a.x,
            top: a.y + topFor(a.blockId),
            color: a.color,
            fontSize: a.size,
            maxWidth: width * 0.6,
            border: editingId === a.id ? `1px dashed ${a.color}` : "1px solid transparent",
            pointerEvents: interactive ? "auto" : "none",
            whiteSpace: "pre-wrap",
            outline: "none",
          }}
          contentEditable={editingId === a.id}
          suppressContentEditableWarning
          onPointerDown={(e) => {
            if (tool === "erase") {
              e.stopPropagation();
              onRemove(a.id);
              return;
            }
            if (tool === "text") e.stopPropagation();
          }}
          onDoubleClick={() => tool !== "off" && setEditingId(a.id)}
          onBlur={(e) => {
            const text = e.currentTarget.textContent ?? "";
            setEditingId(null);
            if (!text.trim()) onRemove(a.id);
            else onUpdate(a.id, { text });
          }}
          ref={(el) => {
            if (el && editingId === a.id && document.activeElement !== el) {
              el.textContent = a.text ?? "";
              el.focus();
            }
          }}
        >
          {editingId === a.id ? null : a.text}
        </div>
      ))}
    </div>
  );
}
