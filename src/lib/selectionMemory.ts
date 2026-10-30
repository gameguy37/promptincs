export interface SavedTextSelection {
  blockId: string;
  start: number;
  end: number;
}

export function sameSelectionMemory(a: SavedTextSelection | null, b: SavedTextSelection | null) {
  return a?.blockId === b?.blockId && a?.start === b?.start && a?.end === b?.end;
}

export function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

export function rangeToTextOffsets(editor: HTMLElement, range: Range) {
  const before = document.createRange();
  before.selectNodeContents(editor);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  before.detach?.();
  return { start, end: start + range.toString().length };
}

export function textOffsetsToRange(editor: HTMLElement, start: number, end: number): Range | null {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(0, Math.max(start, end));
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0;
  let foundStart = false;
  let lastText: Text | null = null;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    lastText = textNode;
    const len = textNode.textContent?.length ?? 0;
    const next = pos + len;
    if (!foundStart && from <= next) {
      range.setStart(textNode, Math.max(0, Math.min(len, from - pos)));
      foundStart = true;
    }
    if (foundStart && to <= next) {
      range.setEnd(textNode, Math.max(0, Math.min(len, to - pos)));
      return range;
    }
    pos = next;
  }

  if (foundStart && lastText) {
    range.setEnd(lastText, lastText.textContent?.length ?? 0);
    return range;
  }
  if (lastText) {
    const len = lastText.textContent?.length ?? 0;
    range.setStart(lastText, len);
    range.setEnd(lastText, len);
    return range;
  }
  range.selectNodeContents(editor);
  range.collapse(true);
  return range;
}

export function clearRangeHighlight(key: string) {
  if (typeof CSS === "undefined") return;
  const registry = (CSS as unknown as { highlights?: { delete: (name: string) => void } }).highlights;
  registry?.delete(key);
}

export function paintRangeHighlight(key: string, range: Range | null) {
  if (typeof window === "undefined" || typeof CSS === "undefined" || !range || range.collapsed) {
    clearRangeHighlight(key);
    return;
  }
  const registry = (CSS as unknown as { highlights?: { set: (name: string, value: unknown) => void } }).highlights;
  const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightCtor) return;
  registry.set(key, new HighlightCtor(range.cloneRange()));
}