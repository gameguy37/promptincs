import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Bold,
  GripVertical,
  Italic,
  Plus,
  Trash2,
  FileText,
  Eye,
  EyeOff,
  Ghost,
  Save,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronUp,
  FolderOpen,
  FileDown,
  Trash,
  FileUp,
  ShieldAlert,
  AlertTriangle,
  Send,
  FilePlus,
  Search,
  Type,
  Underline,
  Minus,
} from "lucide-react";
import { useSwipeable } from "react-swipeable";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { rundownLibrary, type SavedRundown } from "@/lib/rundownLibrary";
import { exportDocx, exportJson, exportMarkdown, exportPdf, exportPromptinc } from "@/lib/exportRundown";
import { importFile } from "@/lib/importRundown";
import { normalizeBookmarkElementText, normalizeBookmarkHtml } from "@/lib/bookmarks";
import {
  clearRangeHighlight,
  cssEscape,
  paintRangeHighlight,
  rangeToTextOffsets,
  textOffsetsToRange,
  type SavedTextSelection,
} from "@/lib/selectionMemory";
import type { PresenceMeta, ProposeChangePayload, SyncRole } from "@/hooks/useTeleprompterSync";
import { DraftEditorDialog } from "./DraftEditorDialog";
import { BlockEditingChip } from "./PresenceBar";
import { Switch } from "@/components/ui/switch";

export interface ScriptBlock {
  id: string;
  title: string;
  body: string;
  bookmarks?: number[];
  ghosted?: boolean;
  /**
   * Three-way visibility:
   *   - 'visible'  — normal (default)
   *   - 'ghosted'  — grayed out but still editable in Edit Mode; hidden in Prompt Mode
   *   - 'hidden'   — removed from Edit Mode canvas entirely; hidden in Prompt Mode
   * Legacy `ghosted:true` (without `visibility`) is treated as 'ghosted'.
   */
  visibility?: BlockVisibility;
}

export type BlockVisibility = "visible" | "ghosted" | "hidden";

export function getBlockVisibility(b: ScriptBlock): BlockVisibility {
  if (b.visibility) return b.visibility;
  if (b.ghosted) return "ghosted";
  return "visible";
}

export function isBlockSkipped(b: ScriptBlock): boolean {
  const v = getBlockVisibility(b);
  return v === "ghosted" || v === "hidden";
}

const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: "System", value: "system-ui, -apple-system, sans-serif" },
  { label: "Helvetica", value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Times", value: "'Times New Roman', Times, serif" },
  { label: "Courier", value: "'Courier New', Courier, monospace" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Impact", value: "Impact, Charcoal, sans-serif" },
];
const RUNDOWN_SELECTION_HIGHLIGHT = "tp-rundown-selection-memory";

function searchableText(html: string): string {
  const text = html
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/\s+/g, " ").trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function editorForNode(node: Node | null): HTMLElement | null {
  const element = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
  return element?.closest<HTMLElement>("[data-rich-editor]") ?? null;
}

function toCssProp(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export function stripStylePropsFromTree(root: Node, propsCamel: string[]): void {
  if (propsCamel.length === 0) return;
  const cssProps = propsCamel.map(toCssProp);
  const visit = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      cssProps.forEach((p) => el.style.removeProperty(p));
    }
    node.childNodes.forEach(visit);
  };
  visit(root);
}

function wrapSelectionInEditor(
  editor: HTMLElement,
  range: Range,
  style: Partial<CSSStyleDeclaration>,
  tagName = "span",
): Range | null {
  if (range.collapsed) return null;
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
  const wrapper = document.createElement(tagName);
  Object.assign(wrapper.style, style);
  if (tagName === "mark") wrapper.style.padding = wrapper.style.padding || "0 0.04em";
  try {
    const contents = range.extractContents();
    // Strip the targeted style props from ALL descendant elements so the new
    // wrapper's inline style isn't overridden by a stale nested span.
    stripStylePropsFromTree(contents, Object.keys(style));
    wrapper.appendChild(contents);
    range.insertNode(wrapper);
  } catch {
    return null;
  }
  const nextRange = document.createRange();
  nextRange.selectNodeContents(wrapper);
  // Only sync the live selection if focus is still in the editor — otherwise
  // we'd clobber the user's focus in a toolbar input.
  if (document.activeElement && editor.contains(document.activeElement)) {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(nextRange);
  }
  return nextRange;
}

function highlightMatch(text: string, needle: string): string {
  const safe = escapeHtml(text);
  if (!needle) return safe;
  const re = new RegExp(escapeRegExp(needle), "gi");
  return safe.replace(
    re,
    (m) => `<mark class="bg-[#f5c84b] text-black rounded-sm px-0.5">${m}</mark>`,
  );
}

interface Props {
  blocks: ScriptBlock[];
  setBlocks: (b: ScriptBlock[]) => void;
  activeId: string | null;
  setActiveId: (id: string) => void;
  disabled?: boolean;
  fontFamily?: string;
  allCaps?: boolean;
  onJumpToBlock?: (id: string) => void;
  /** Edit-mode: scroll the continuous canvas to this block (single click). */
  onScrollToBlock?: (id: string, offsetRatio?: number) => void;
  /** Current host mode — used to escalate the backup-edit warning when the host is live. */
  hostMode?: "edit" | "prompt";
  /** Bubbles backupMode state up so the host canvas can lock its editors. */
  onBackupModeChange?: (on: boolean) => void;
  /** This instance's sync role. Clients cannot edit live; they push drafts. */
  userRole?: SyncRole;
  /** All connected peers in the room (for per-block "X is editing" chips). */
  peers?: PresenceMeta[];
  /** This user's id so we can exclude ourselves from peer chips. */
  selfUserId?: string | null;
  /** Update presence: which block is THIS user currently editing (null = none). */
  onSetEditingBlock?: (id: string | null) => void;
  /** Broadcast a draft to all peers (the host will apply + ack). */
  onSendProposeChange?: (payload: ProposeChangePayload) => void;
  /** Subscribe to ACK for a change_id; returns unsubscribe. */
  registerAckListener?: (changeId: string, onAck: () => void) => () => void;
  /** Used as `from_user` on proposals. */
  selfUserName?: string;
  /** Optional Stage Cue (PIP) integration — when provided, the Rundown
   *  sidebar shows a compact PIP control panel (toggle + text + presets)
   *  so the host never has to leave the rundown to update it live. */
  pipConfig?: {
    enabled: boolean;
    text: string;
    opacity?: number;
    scale?: number;
    fontSize?: number;
  };
  onPipChange?: (patch: Partial<{
    enabled: boolean;
    text: string;
    opacity: number;
    scale: number;
    fontSize: number;
  }>) => void;
}

function RundownImpl({
  blocks,
  setBlocks,
  activeId,
  setActiveId,
  disabled,
  fontFamily,
  allCaps,
  onJumpToBlock,
  onScrollToBlock,
  hostMode = "edit",
  onBackupModeChange,
  userRole = "host",
  peers = [],
  selfUserId = null,
  onSetEditingBlock,
  onSendProposeChange,
  registerAckListener,
  selfUserName = "Client",
  pipConfig,
  onPipChange,
}: Props) {
  const isClient = userRole === "client";
  const [draftBlockId, setDraftBlockId] = useState<string | null>(null);
  const draftBlock = draftBlockId ? (blocks.find((b) => b.id === draftBlockId) ?? null) : null;
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Focus target — when set, the next render will focus the matching title
  // input and clear the ref. This keeps "add block" workflows keyboard-first:
  // the user names the block immediately without a second click.
  const focusBlockIdRef = useRef<string | null>(null);
  // Local PIP presets library (per browser) so hosts can save common cues
  // ("Atlantic City, NJ 🎤", "SMILE 😀", "SLOW DOWN") *with* their exact
  // style (font size, opacity, scale) and recall them on the fly. Legacy
  // string-only entries from tp.pip.presets.v1 are auto-migrated to v2.
  type PipPreset = {
    text: string;
    fontSize?: number;
    opacity?: number;
    scale?: number;
  };
  // Presets live in localStorage, which SSR can't see. Load them after mount
  // so the server and client first render match exactly.
  const [pipPresets, setPipPresets] = useState<PipPreset[]>([]);
  useEffect(() => {
    try {
      const rawV2 = localStorage.getItem("tp.pip.presets.v2");
      if (rawV2) {
        const parsed = JSON.parse(rawV2);
        if (Array.isArray(parsed)) {
          setPipPresets(parsed.filter((p) => p && typeof p.text === "string"));
          return;
        }
      }
      const rawV1 = localStorage.getItem("tp.pip.presets.v1");
      const parsedV1 = rawV1 ? JSON.parse(rawV1) : null;
      if (Array.isArray(parsedV1)) {
        setPipPresets(
          parsedV1.filter((s: unknown) => typeof s === "string").map((text: string) => ({ text })),
        );
      }
    } catch {
      /* ignore */
    }
  }, []);
  const persistPipPresets = (next: PipPreset[]) => {
    setPipPresets(next);
    try {
      localStorage.setItem("tp.pip.presets.v2", JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  };
  // ----- Collapsible Rundown drawer -----
  const [isRundownOpen, setIsRundownOpen] = useState(false);
  // ----- Backup mode: edits are buffered per block; "Apply" pushes to host with a confirm. -----
  const [backupMode, setBackupMode] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingApplyId, setPendingApplyId] = useState<string | null>(null);
  // Backup-draft persistence keys
  const DRAFTS_KEY = "tp.backup.drafts.v1";
  const BACKUP_FLAG_KEY = "tp.backup.mode.v1";
  // ----- Saved rundown library (named, multiple, local-only for now) -----
  const [library, setLibrary] = useState<SavedRundown[]>([]);
  const [currentRundownId, setCurrentRundownId] = useState<string | null>(null);
  const [currentRundownName, setCurrentRundownName] = useState<string>("");
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Autosave when host enters Live (prompt) mode.
  const AUTOSAVE_KEY = "tp.autosaveOnLive.v1";
  const [autosaveOnLive, setAutosaveOnLive] = useState(false);
  const [rundownSearch, setRundownSearch] = useState("");
  const [rundownFontSize, setRundownFontSize] = useState("96");
  const [rundownTextColor, setRundownTextColor] = useState("#ffffff");
  const [rundownHighlightColor, setRundownHighlightColor] = useState("#fde047");
  const activeRundownEditorRef = useRef<HTMLElement | null>(null);
  const savedRundownRangeRef = useRef<Range | null>(null);
  const savedRundownSelectionRef = useRef<SavedTextSelection | null>(null);
  const rundownToolbarGuardRef = useRef(false);
  const normalizedSearch = rundownSearch.trim().toLowerCase();
  const visibleBlocks = useMemo(() => {
    if (!normalizedSearch) return blocks.map((block) => ({ block, snippet: "", index: -1 }));
    return blocks
      .map((block) => {
        const haystack = `${block.title} ${searchableText(block.body || "")}`;
        const lower = haystack.toLowerCase();
        const index = lower.indexOf(normalizedSearch);
        const start = Math.max(0, index - 34);
        const snippet =
          index >= 0 ? haystack.slice(start, index + normalizedSearch.length + 52).trim() : "";
        return { block, snippet, index };
      })
      .filter((item) => item.index >= 0);
  }, [blocks, normalizedSearch]);
  const matches = visibleBlocks.filter((v) => v.index >= 0);
  const [matchCursor, setMatchCursor] = useState(0);
  useEffect(() => {
    setMatchCursor(0);
  }, [normalizedSearch]);
  const stepMatch = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (matchCursor + dir + matches.length) % matches.length;
    setMatchCursor(next);
    const m = matches[next];
    const ratio =
      m.index >= 0
        ? Math.max(0, Math.min(1, m.index / Math.max(1, searchableText(m.block.body || "").length)))
        : undefined;
    setActiveId(m.block.id);
    onScrollToBlock?.(m.block.id, ratio);
  };

  const repaintRundownMemory = () => {
    const memory = savedRundownSelectionRef.current;
    const editor = memory
      ? document.querySelector<HTMLElement>(
          `[data-rich-editor][data-block-id="${cssEscape(memory.blockId)}"]`,
        )
      : null;
    const range = memory && editor ? textOffsetsToRange(editor, memory.start, memory.end) : null;
    paintRangeHighlight(RUNDOWN_SELECTION_HIGHLIGHT, range && !range.collapsed ? range : null);
  };

  const rememberRundownMemory = (memory: SavedTextSelection | null) => {
    savedRundownSelectionRef.current = memory;
    repaintRundownMemory();
  };

  const rememberRundownSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const editor =
      editorForNode(range.commonAncestorContainer) ?? editorForNode(range.startContainer);
    if (!editor || !editor.contains(range.startContainer) || !editor.contains(range.endContainer))
      return;
    activeRundownEditorRef.current = editor;
    if (!range.collapsed) {
      savedRundownRangeRef.current = range.cloneRange();
      const blockId = editor.dataset.blockId;
      if (blockId) rememberRundownMemory({ blockId, ...rangeToTextOffsets(editor, range) });
    }
  };

  const protectRundownToolbarSelection = (event?: React.PointerEvent | React.MouseEvent) => {
    rememberRundownSelection();
    rundownToolbarGuardRef.current = true;
    if (event && event.currentTarget instanceof HTMLButtonElement) event.preventDefault();
    window.setTimeout(() => {
      rundownToolbarGuardRef.current = false;
    }, 250);
  };

  const restoreRundownSelection = (): Range | null => {
    const saved = savedRundownSelectionRef.current;
    const editor = saved
      ? document.querySelector<HTMLElement>(
          `[data-rich-editor][data-block-id="${cssEscape(saved.blockId)}"]`,
        )
      : activeRundownEditorRef.current;
    if (!editor) return null;
    activeRundownEditorRef.current = editor;
    const range = saved
      ? textOffsetsToRange(editor, saved.start, saved.end)
      : (savedRundownRangeRef.current?.cloneRange() ?? null);
    if (!range) return null;
    editor.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return range;
  };

  const applyRundownStyle = (style: Partial<CSSStyleDeclaration>, tagName = "span") => {
    const restored = restoreRundownSelection();
    const editor = activeRundownEditorRef.current;
    const range = restored ?? savedRundownRangeRef.current;
    if (!editor || !range) return;
    const next = wrapSelectionInEditor(editor, range.cloneRange(), style, tagName);
    if (!next) return;
    const id = editor.dataset.blockId;
    const offsets = rangeToTextOffsets(editor, next);
    // Focus the editor and place the live selection on the freshly-wrapped
    // range so the next toolbar click captures a fresh live selection.
    editor.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(next);
    savedRundownRangeRef.current = next.cloneRange();
    normalizeBookmarkElementText(editor);
    const html = editor.innerHTML;
    if (id) handleBodyChange(id, html);
    // After React commits (BlockEditor may re-hydrate innerHTML), re-anchor
    // focus and selection in the live DOM, then clear the stored ref so it
    // can't hold stale coordinates for subsequent formatting commands.
    requestAnimationFrame(() => {
      const liveEditor = id
        ? (document.querySelector<HTMLElement>(
            `[data-rich-editor][data-block-id="${cssEscape(id)}"]`,
          ) ?? editor)
        : editor;
      liveEditor.focus({ preventScroll: true });
      const r = textOffsetsToRange(liveEditor, offsets.start, offsets.end);
      if (r) {
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
        savedRundownRangeRef.current = r.cloneRange();
      }
      activeRundownEditorRef.current = liveEditor;
      savedRundownSelectionRef.current = null;
      clearRangeHighlight(RUNDOWN_SELECTION_HIGHLIGHT);
      rundownToolbarGuardRef.current = false;
    });
  };

  const stepRundownFontSize = (event: React.MouseEvent<HTMLButtonElement>, delta: 2 | -2) => {
    event.preventDefault();
    const currentSize = rundownFontSize;
    const cleanSize = parseInt(String(currentSize).replace(/[^0-9]/g, ""), 10);
    const baseSize = Number.isNaN(cleanSize) ? 24 : cleanSize;
    const newSize =
      delta < 0 ? Math.max(10, baseSize - 2) : Math.max(10, Math.min(400, baseSize + 2));
    const formattedSize = `${newSize}px`;
    setRundownFontSize(String(newSize));
    applyRundownStyle({ fontSize: formattedSize });
  };

  const applyRundownFontSize = (px: number) => {
    const safePx = Math.max(10, Math.min(400, px));
    applyRundownStyle({ fontSize: `${safePx}px` });
  };

  const applyRundownCommand = (command: string) => {
    const restored = restoreRundownSelection();
    const editor = activeRundownEditorRef.current;
    const range = restored ?? savedRundownRangeRef.current;
    if (!editor || !range) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand(command);
    normalizeBookmarkElementText(editor);
    const id = editor.dataset.blockId;
    if (id) handleBodyChange(id, editor.innerHTML);
    rememberRundownSelection();
  };

  useEffect(() => {
    repaintRundownMemory();
    return () => clearRangeHighlight(RUNDOWN_SELECTION_HIGHLIGHT);
  }, [blocks, drafts]);

  useEffect(() => {
    const onSelectionChange = () => {
      if (rundownToolbarGuardRef.current) return;
      rememberRundownSelection();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  const handleImportFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImporting(true);
    try {
      const newBlocks: ScriptBlock[] = [];
      for (const file of Array.from(files)) {
        try {
          const imported = await importFile(file);
          newBlocks.push(...imported);
        } catch (err) {
          console.error(err);
          toast.error(`Couldn't import ${file.name}: ${(err as Error).message}`);
        }
      }
      if (newBlocks.length > 0) {
        setBlocks([...blocks, ...newBlocks]);
        setActiveId(newBlocks[0].id);
        toast.success(`Imported ${newBlocks.length} block${newBlocks.length === 1 ? "" : "s"}`);
      }
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Electron desktop bridge: when the user double-clicks a .promptinc file
  // (or opens one via File → Open in the desktop app), the Electron main
  // process reads the bytes and dispatches this event on window. We convert
  // the payload into a real File and reuse the same import path the browser
  // uses for drag-and-drop / file picker so the script lands in the full
  // Edit Mode canvas.
  useEffect(() => {
    if (isClient) return;
    const onElectronOpen = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { name?: string; base64?: string; text?: string }
        | undefined;
      if (!detail) return;
      let file: File | null = null;
      if (detail.base64) {
        const bin = atob(detail.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        file = new File([bytes], detail.name || "script.promptinc", {
          type: "application/vnd.promptinc.script+json",
        });
      } else if (typeof detail.text === "string") {
        file = new File([detail.text], detail.name || "script.promptinc", {
          type: "application/vnd.promptinc.script+json",
        });
      }
      if (!file) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      void handleImportFiles(dt.files);
    };
    window.addEventListener("promptinc:electron-import", onElectronOpen as EventListener);
    // Signal readiness so the Electron main process can flush any queued file.
    try {
      (window as unknown as { __promptincReady?: boolean }).__promptincReady = true;
      window.dispatchEvent(new Event("promptinc:renderer-ready"));
    } catch {
      /* noop */
    }
    return () =>
      window.removeEventListener(
        "promptinc:electron-import",
        onElectronOpen as EventListener,
      );
  }, [blocks, isClient]);

  // Window-wide drag-and-drop: drop a .docx/.pdf/.txt/.md/.json anywhere
  // on the app and it gets imported as new rundown block(s).
  useEffect(() => {
    if (isClient) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragOver(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        void handleImportFiles(e.dataTransfer.files);
      }
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, blocks]);

  // Cmd/Ctrl+S → save the script to disk via the native file picker, so the
  // user can choose any folder, including Dropbox / OneDrive / iCloud synced
  // folders. Falls back to a normal download on browsers without the picker.
  // Toolbar "Open" button (and ⌘O) → trigger the hidden file picker.
  useEffect(() => {
    const onOpen = () => fileInputRef.current?.click();
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== "o" && e.key !== "O") return;
      e.preventDefault();
      onOpen();
    };
    window.addEventListener("promptinc:open-file", onOpen);
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("promptinc:open-file", onOpen);
      window.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions);
    };
  }, []);

  useEffect(() => {
    if (isClient) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== "s" && e.key !== "S") return;
      e.preventDefault();
      e.stopPropagation();
      // Keep the in-browser library copy in sync if this script is named.
      if (currentRundownId && currentRundownName) {
        const item = rundownLibrary.save(currentRundownName, blocks, activeId, currentRundownId);
        rundownLibrary.setLastOpened(item.id);
        refreshLibrary();
      }
      void exportPromptinc(currentRundownName || "Rundown", blocks)
        .then(() => toast.success("Script saved"))
        .catch((err) => {
          console.error(err);
          toast.error("Save failed");
        });
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, blocks, currentRundownId, currentRundownName, activeId]);

  const refreshLibrary = () => setLibrary(rundownLibrary.list());
  useEffect(() => {
    refreshLibrary();
    // Blank slate: never auto-open old rundowns, inject welcome copy, or
    // restore Backup Mode — Backup Mode intentionally locks the main editor.
    rundownLibrary.setLastOpened(null);
    setCurrentRundownId(null);
    setCurrentRundownName("");
    setBackupMode(false);
    setDrafts({});
    try {
      localStorage.removeItem(DRAFTS_KEY);
      localStorage.removeItem(BACKUP_FLAG_KEY);
    } catch {
      /* ignore */
    }
    try {
      if (localStorage.getItem(AUTOSAVE_KEY) === "1") setAutosaveOnLive(true);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (autosaveOnLive) localStorage.setItem(AUTOSAVE_KEY, "1");
      else localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      /* ignore */
    }
  }, [autosaveOnLive]);

  // Autosave on edit→prompt transition.
  const prevHostMode = useRef(hostMode);
  useEffect(() => {
    if (prevHostMode.current === "edit" && hostMode === "prompt" && autosaveOnLive && !isClient) {
      if (currentRundownId && currentRundownName) {
        const item = rundownLibrary.save(currentRundownName, blocks, activeId, currentRundownId);
        rundownLibrary.setLastOpened(item.id);
        refreshLibrary();
        toast.success(`Autosaved "${item.name}"`);
      } else {
        const name = `Rundown ${new Date().toLocaleString()}`;
        const item = rundownLibrary.save(name, blocks, activeId);
        setCurrentRundownId(item.id);
        setCurrentRundownName(item.name);
        rundownLibrary.setLastOpened(item.id);
        refreshLibrary();
        toast.success(`Autosaved "${item.name}"`);
      }
    }
    prevHostMode.current = hostMode;
  }, [hostMode, autosaveOnLive, isClient, currentRundownId, currentRundownName, blocks, activeId]);

  const newScript = () => {
    if (isClient) {
      toast.error("Client mode: only the host can start a new script");
      return;
    }
    if (
      blocks.length > 0 &&
      !confirm("Start a fresh script? Unsaved changes will be lost (use Save first to keep them).")
    )
      return;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `b_${Date.now()}`;
    setBlocks([{ id, title: "Untitled", body: "<p></p>" }]);
    setActiveId(id);
    setCurrentRundownId(null);
    setCurrentRundownName("");
    rundownLibrary.setLastOpened(null);
    setDrafts({});
    toast.success("New script ready");
  };

  // Persist drafts on every change so a refresh restores them.
  useEffect(() => {
    try {
      if (Object.keys(drafts).length > 0) {
        localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
      } else {
        localStorage.removeItem(DRAFTS_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [drafts]);

  // Persist backup-mode flag and bubble it up to the host canvas.
  useEffect(() => {
    try {
      if (backupMode) localStorage.setItem(BACKUP_FLAG_KEY, "1");
      else localStorage.removeItem(BACKUP_FLAG_KEY);
    } catch {
      /* ignore */
    }
    onBackupModeChange?.(backupMode);
  }, [backupMode, onBackupModeChange]);

  const handleSave = () => {
    if (currentRundownId && currentRundownName) {
      const item = rundownLibrary.save(currentRundownName, blocks, activeId, currentRundownId);
      setCurrentRundownId(item.id);
      setCurrentRundownName(item.name);
      rundownLibrary.setLastOpened(item.id);
      refreshLibrary();
      toast.success(`Saved "${item.name}"`);
      void exportJson(item.name, blocks);
    } else {
      setSaveAsName(currentRundownName || `Rundown ${new Date().toLocaleDateString()}`);
      setSaveAsOpen(true);
    }
  };

  const handleSaveAs = () => {
    const item = rundownLibrary.save(saveAsName, blocks, activeId);
    setCurrentRundownId(item.id);
    setCurrentRundownName(item.name);
    rundownLibrary.setLastOpened(item.id);
    refreshLibrary();
    setSaveAsOpen(false);
    toast.success(`Saved "${item.name}"`);
    void exportJson(item.name, blocks);
  };

  const loadRundown = (id: string) => {
    const item = rundownLibrary.get(id);
    if (!item) {
      toast.error("Rundown not found");
      return;
    }
    setBlocks(item.blocks);
    if (item.activeId) setActiveId(item.activeId);
    setCurrentRundownId(item.id);
    setCurrentRundownName(item.name);
    rundownLibrary.setLastOpened(item.id);
    toast.success(`Loaded "${item.name}"`);
  };

  const deleteRundown = (id: string, name: string) => {
    rundownLibrary.remove(id);
    if (currentRundownId === id) {
      setCurrentRundownId(null);
      setCurrentRundownName("");
      rundownLibrary.setLastOpened(null);
    }
    refreshLibrary();
    toast.success(`Deleted "${name}"`);
  };

  const exportName = currentRundownName || "Rundown";
  const handleExport = async (fmt: "docx" | "pdf" | "md" | "json" | "promptinc") => {
    try {
      if (fmt === "md") await exportMarkdown(exportName, blocks);
      else if (fmt === "json") await exportJson(exportName, blocks);
      else if (fmt === "promptinc") await exportPromptinc(exportName, blocks);
      else if (fmt === "pdf") await exportPdf(exportName, blocks);
      else if (fmt === "docx") await exportDocx(exportName, blocks);
      toast.success(`Exported .${fmt}`);
    } catch (err) {
      console.error(err);
      toast.error(`Export failed (.${fmt})`);
    }
  };

  const addBlock = () => {
    const id = crypto.randomUUID();
    setBlocks([...blocks, { id, title: `Block ${blocks.length + 1}`, body: "<p></p>" }]);
    setActiveId(id);
    setCollapsed((c) => ({ ...c, [id]: false }));
    focusBlockIdRef.current = id;
    // Make sure the drawer is open so the newly-focused input is visible.
    setIsRundownOpen(true);
  };

  /** Insert a new block at a specific index (used by the inline "+" dividers
   *  between existing blocks). Keeps the new block expanded and focused. */
  const insertBlockAt = (index: number) => {
    const id = crypto.randomUUID();
    const next = [...blocks];
    const clampedIndex = Math.max(0, Math.min(index, next.length));
    next.splice(clampedIndex, 0, { id, title: `Block ${blocks.length + 1}`, body: "<p></p>" });
    setBlocks(next);
    setActiveId(id);
    setCollapsed((c) => ({ ...c, [id]: false }));
    focusBlockIdRef.current = id;
    setIsRundownOpen(true);
  };

  // Global keyboard shortcut: Cmd/Ctrl+Shift+B → add a new block instantly,
  // regardless of which panel currently has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        addBlock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  // After the React state commits a new block, focus its title input in the
  // sidebar so the user can type immediately — no mode toggle required.
  useEffect(() => {
    const targetId = focusBlockIdRef.current;
    if (!targetId) return;
    if (!blocks.some((b) => b.id === targetId)) return;
    focusBlockIdRef.current = null;
    // Wait one frame so the drawer transition + input render both settle.
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(
        `input[data-block-title="${targetId}"]`,
      );
      if (el) {
        el.focus();
        el.select();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [blocks]);

  const removeBlock = (id: string) => {
    setBlocks(blocks.filter((b) => b.id !== id));
  };

  const updateBlock = (id: string, patch: Partial<ScriptBlock>) => {
    setBlocks(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  // Buffered edit: in backup mode, body changes go into `drafts` instead of `blocks`.
  const handleBodyChange = (id: string, html: string) => {
    const nextHtml = normalizeBookmarkHtml(html);
    if (backupMode) {
      setDrafts((d) => ({ ...d, [id]: nextHtml }));
    } else {
      updateBlock(id, { body: nextHtml });
    }
  };
  const discardDraft = (id: string) =>
    setDrafts((d) => {
      const { [id]: _, ...rest } = d;
      return rest;
    });
  const applyDraft = (id: string) => {
    const html = drafts[id];
    if (html === undefined) return;
    // Push directly with a fresh array to avoid any stale `blocks` closure.
    const next = blocks.map((b) => (b.id === id ? { ...b, body: html } : b));
    setBlocks(next);
    discardDraft(id);
    toast.success("Pushed change to host");
  };
  const pendingBlock = pendingApplyId ? blocks.find((b) => b.id === pendingApplyId) : null;
  const hostLive = hostMode === "prompt";

  const onDragStart = (id: string) => setDraggedId(id);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    const from = blocks.findIndex((b) => b.id === draggedId);
    const to = blocks.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setBlocks(next);
    setDraggedId(null);
  };

  const moveBlock = (id: string, dir: -1 | 1) => {
    const from = blocks.findIndex((b) => b.id === id);
    if (from < 0) return;
    const to = from + dir;
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setBlocks(next);
  };

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => setIsRundownOpen(false),
    trackMouse: true,
    trackTouch: true,
    delta: 40,
  });

  const DRAWER_WIDTH = "min(440px, 92vw)";

  return (
    <>
      {dragOver && !isClient && (
        <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-md border-2 border-dashed border-[#0055ff] bg-[#141414] px-8 py-6 text-center">
            <FileUp className="mx-auto mb-2 h-8 w-8 text-[#0055ff]" strokeWidth={1.5} />
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-[#e5e5e5]">
              Drop to import
            </div>
            <div className="mt-1 text-[11px] text-[#888]">
              .promptinc, .docx, .pdf, .txt, .md, .json — formatting & page breaks preserved
            </div>
          </div>
        </div>
      )}
      {/* Dimming backdrop while the drawer is open */}
      {isRundownOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] transition-opacity"
          onClick={() => setIsRundownOpen(false)}
          aria-hidden
        />
      )}
      {/* Collapsible Rundown drawer — slides via translateX so the Edit Mode
          canvas fills 100% of the window width when closed. */}
      <div
        {...swipeHandlers}
        className="fixed left-0 top-0 z-50 flex h-full flex-col border-r border-[#2a2a2a] bg-[#141414] text-[#e5e5e5] shadow-2xl transition-transform duration-300 ease-in-out will-change-transform"
        style={{
          width: DRAWER_WIDTH,
          transform: isRundownOpen ? "translateX(0)" : "translateX(-100%)",
        }}
      >
        {/* Slim vertical toggle tab — Tandy Red accent, retro TRS-1 aesthetic.
            It rides the drawer's right edge so it stays visible open or closed. */}
        <button
          type="button"
          onClick={() => setIsRundownOpen((v) => !v)}
          disabled={disabled}
          aria-label={isRundownOpen ? "Close rundown" : "Open rundown"}
          className="absolute -right-7 top-1/2 z-10 flex h-20 w-7 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-r-sm border border-l-0 border-[#0055ff] bg-[#1a1a1a] text-[#0055ff] shadow-[2px_0_0_#000] transition-colors hover:bg-[#0055ff] hover:text-[#0c0c0c] disabled:opacity-40"
        >
          {isRundownOpen ? (
            <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
          ) : (
            <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
          )}
          <span className="text-[8px] font-bold uppercase tracking-[0.2em] [writing-mode:vertical-rl]">
            Rundown
          </span>
        </button>

        <div className="flex items-center gap-2 border-b border-[#2a2a2a] p-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#888]">
          <FileText className="h-3.5 w-3.5" strokeWidth={1.5} /> Rundown
          {currentRundownName && (
            <span className="ml-1 normal-case tracking-normal text-[#aaa] font-normal truncate">
              · {currentRundownName}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-3">
            {/* Backup mode toggle — buffers edits and requires confirm to push to host. */}
            <button
              type="button"
              onClick={() => {
                if (backupMode && Object.keys(drafts).length > 0) {
                  if (!confirm("Discard unsaved backup edits?")) return;
                  setDrafts({});
                }
                setBackupMode((v) => !v);
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-sm border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] transition-colors ${
                backupMode
                  ? "border-[#0055ff]/60 bg-[#0055ff]/10 text-[#4d8bff]"
                  : "border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:bg-[#1f1f1f]"
              }`}
              title="Backup mode buffers edits and requires confirmation before pushing to the host"
            >
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="h-3 w-3" strokeWidth={1.5} /> Backup Mode
                {backupMode && hostLive && (
                  <span className="ml-1 inline-flex items-center gap-1 rounded-sm bg-[#0055ff]/20 px-1.5 py-0.5 text-[9px] tracking-wider text-[#8ab0ff]">
                    <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2} /> HOST LIVE
                  </span>
                )}
              </span>
              <span className="text-[9px] text-[#666]">{backupMode ? "ON" : "OFF"}</span>
            </button>

            {/* Autosave on Live toggle */}
            <div className="flex items-center justify-between gap-2 rounded-sm border border-[#2a2a2a] bg-[#1a1a1a] px-2.5 py-1.5">
              <div className="flex flex-col">
                <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#888]">
                  Autosave on Live
                </span>
                <span className="text-[9px] text-[#555]">
                  Saves rundown when entering Prompt Mode
                </span>
              </div>
              <Switch
                checked={autosaveOnLive}
                onCheckedChange={setAutosaveOnLive}
                aria-label="Autosave when entering live mode"
              />
            </div>

            <Button
              onClick={newScript}
              size="sm"
              variant="outline"
              className="h-8 w-full rounded-sm border-[#2a2a2a] bg-transparent text-[11px] font-medium uppercase tracking-wider text-[#e5e5e5] hover:bg-[#1a1a1a]"
              title="Start a fresh empty script"
            >
              <FilePlus className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} /> New Script
            </Button>

            <div className="grid grid-cols-3 gap-2">
              <Button
                onClick={handleSave}
                size="sm"
                variant="outline"
                className="h-8 rounded-sm border-[#2a2a2a] bg-transparent text-[11px] font-medium uppercase tracking-wider text-[#e5e5e5] hover:bg-[#1a1a1a]"
                title={
                  currentRundownId
                    ? `Save changes to "${currentRundownName}"`
                    : "Save as a new rundown"
                }
              >
                <Save className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} /> Save
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-sm border-[#2a2a2a] bg-transparent text-[11px] font-medium uppercase tracking-wider text-[#e5e5e5] hover:bg-[#1a1a1a]"
                    title="Open a saved rundown"
                  >
                    <FolderOpen className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} /> Open
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-80 w-72 overflow-y-auto border-[#2a2a2a] bg-[#141414] text-[#e5e5e5]"
                >
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-[#888]">
                    Saved Rundowns ({library.length})
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-[#2a2a2a]" />
                  {library.length === 0 && (
                    <div className="px-2 py-2 text-xs text-[#888]">No saved rundowns yet.</div>
                  )}
                  {library.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-1 px-1 py-0.5 hover:bg-[#1f1f1f] rounded-sm"
                    >
                      <button
                        type="button"
                        onClick={() => loadRundown(r.id)}
                        className="flex-1 text-left px-2 py-1.5 text-xs text-[#e5e5e5] truncate"
                        title={`Load "${r.name}"`}
                      >
                        <div className="font-medium truncate">{r.name}</div>
                        <div className="text-[10px] text-[#888]">
                          {r.blocks.length} block{r.blocks.length === 1 ? "" : "s"} ·{" "}
                          {new Date(r.savedAt).toLocaleString()}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRundown(r.id, r.name);
                        }}
                        className="p-1.5 text-[#888] hover:text-[#0055ff]"
                        title={`Delete "${r.name}"`}
                      >
                        <Trash className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-sm border-[#2a2a2a] bg-transparent text-[11px] font-medium uppercase tracking-wider text-[#e5e5e5] hover:bg-[#1a1a1a]"
                    title="Export the script to a file"
                  >
                    <FileDown className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} /> Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-56 border-[#2a2a2a] bg-[#141414] text-[#e5e5e5]"
                >
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-[#888]">
                    Export "{exportName}"
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-[#2a2a2a]" />
                  <DropdownMenuItem onClick={() => handleExport("promptinc")} className="text-xs font-medium">
                    PrompTinc Script (.promptinc)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("docx")} className="text-xs">
                    Word (.docx)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("pdf")} className="text-xs">
                    PDF (.pdf)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("md")} className="text-xs">
                    Markdown (.md)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("json")} className="text-xs">
                    PrompTinc JSON (.json)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-[#2a2a2a]" />
                  <div className="px-2 py-1.5 text-[10px] text-[#888]">
                    Ghosted blocks are included and marked.
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {saveAsOpen && (
              <div className="rounded-sm border border-[#2a2a2a] bg-[#1a1a1a] p-2.5 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#888]">
                  Name this rundown
                </div>
                <Input
                  autoFocus
                  value={saveAsName}
                  onChange={(e) => setSaveAsName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveAs();
                    if (e.key === "Escape") setSaveAsOpen(false);
                  }}
                  placeholder="e.g. Morning Show — Mon"
                  className="h-8 rounded-sm border-[#2a2a2a] bg-[#0c0c0c] text-xs text-[#e5e5e5] placeholder:text-[#555]"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveAs}
                    size="sm"
                    className="h-7 flex-1 rounded-sm border border-[#2a2a2a] bg-[#1f1f1f] text-[11px] uppercase tracking-wider text-[#e5e5e5] shadow-none hover:bg-[#262626]"
                  >
                    Save
                  </Button>
                  <Button
                    onClick={() => setSaveAsOpen(false)}
                    size="sm"
                    variant="ghost"
                    className="h-7 rounded-sm text-[11px] uppercase tracking-wider text-[#888] hover:bg-[#1a1a1a]"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-sm border border-[#2a2a2a] bg-[#1a1a1a] p-2.5 space-y-2">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#888]">
                <FileUp className="h-3 w-3" strokeWidth={1.5} /> Import Document
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".promptinc,.docx,.pdf,.txt,.md,.markdown,.json"
                multiple
                className="hidden"
                onChange={(e) => handleImportFiles(e.target.files)}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                size="sm"
                className="h-8 w-full rounded-sm border border-[#2a2a2a] bg-[#1f1f1f] text-xs font-medium uppercase tracking-wider text-[#e5e5e5] shadow-none hover:bg-[#262626]"
              >
                {importing ? "Importing..." : "Choose File(s)"}
              </Button>
              <div className="text-[10px] text-[#666] leading-snug">
                Supports .promptinc, .docx, .pdf, .txt, .md, .json — auto-splits into blocks at headings.
              </div>
            </div>

            <Button
              onClick={addBlock}
              title="Add a new block (⌘/Ctrl+Shift+B)"
              className="h-9 w-full rounded-sm border border-[#0055ff]/60 bg-[#0055ff]/15 text-xs font-semibold uppercase tracking-wider text-[#ff9a9a] shadow-none hover:bg-[#0055ff]/25 hover:text-white"
              variant="outline"
            >
              <Plus className="mr-1.5 h-4 w-4" strokeWidth={2} /> Add Block
              <span className="ml-2 rounded-sm border border-[#0055ff]/40 px-1 py-[1px] text-[9px] tracking-widest text-[#ff9a9a]/70">⌘⇧B</span>
            </Button>

            {pipConfig && onPipChange && (
              <div className="rounded-sm border border-[#2a2a2a] bg-[#1a1a1a] p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.15em] text-[#888]">
                  <span>Stage Cue / PIP</span>
                  <label className="flex items-center gap-1 normal-case tracking-normal">
                    <input
                      type="checkbox"
                      checked={pipConfig.enabled}
                      onChange={(e) => onPipChange({ enabled: e.target.checked })}
                    />
                    <span className="text-[#bbb]">{pipConfig.enabled ? "On" : "Off"}</span>
                  </label>
                </div>
                <textarea
                  value={pipConfig.text}
                  onChange={(e) => onPipChange({ text: e.target.value })}
                  rows={2}
                  placeholder="You're in Atlantic City, NJ! 🎤"
                  className="w-full resize-none rounded-sm border border-[#2a2a2a] bg-[#111] p-1.5 text-xs text-[#e5e5e5] outline-none focus:border-[#3a3a3a]"
                />
                {pipPresets.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {pipPresets.map((preset, i) => (
                      <span
                        key={`${preset.text}-${i}`}
                        className="group inline-flex items-center gap-1 rounded-sm border border-[#2a2a2a] bg-[#111] px-1.5 py-0.5 text-[10px] text-[#ccc]"
                      >
                        <button
                          type="button"
                          className="max-w-[140px] truncate hover:text-white"
                          title={`${preset.text}${preset.fontSize ? ` · ${preset.fontSize}px` : ""}`}
                          onClick={() =>
                            onPipChange({
                              text: preset.text,
                              enabled: true,
                              ...(preset.fontSize != null ? { fontSize: preset.fontSize } : {}),
                              ...(preset.opacity != null ? { opacity: preset.opacity } : {}),
                              ...(preset.scale != null ? { scale: preset.scale } : {}),
                            })
                          }
                        >
                          {preset.text}
                        </button>
                        <button
                          type="button"
                          className="text-[#666] opacity-0 hover:text-[#ff9a9a] group-hover:opacity-100"
                          onClick={() =>
                            persistPipPresets(pipPresets.filter((_, j) => j !== i))
                          }
                          aria-label={`Remove preset ${preset.text}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 rounded-sm border-[#2a2a2a] bg-[#111] text-[10px] uppercase tracking-wider text-[#ccc] hover:bg-[#1f1f1f]"
                    onClick={() => {
                      const t = pipConfig.text.trim();
                      if (!t) return;
                      const entry: PipPreset = {
                        text: t,
                        fontSize: pipConfig.fontSize,
                        opacity: pipConfig.opacity,
                        scale: pipConfig.scale,
                      };
                      const dedup = pipPresets.filter((p) => p.text !== t);
                      persistPipPresets([entry, ...dedup].slice(0, 12));
                    }}
                  >
                    Save preset (text + style)
                  </Button>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[#888]">
                    <span>Font size</span>
                    <span className="tabular-nums text-[#ccc]">
                      {pipConfig.fontSize ?? 22}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={12}
                    max={72}
                    step={1}
                    value={pipConfig.fontSize ?? 22}
                    onChange={(e) => onPipChange({ fontSize: Number(e.target.value) })}
                    className="w-full accent-[#0055ff]"
                  />
                </div>
                <div className="text-[10px] leading-snug text-[#666]">
                  Presets store the text and current style. In Prompt Mode
                  press <kbd className="rounded border border-[#333] px-1">C</kbd> to
                  toggle the cue. Opacity + scale live in Prompter Settings.
                </div>
              </div>
            )}

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#666]"
                strokeWidth={1.5}
              />
              <Input
                value={rundownSearch}
                onChange={(e) => setRundownSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    stepMatch(e.shiftKey ? -1 : 1);
                  } else if (e.key === "Escape") {
                    setRundownSearch("");
                  }
                }}
                placeholder="Search rundown"
                className="h-8 rounded-sm border-[#2a2a2a] bg-[#0c0c0c] pl-7 pr-12 text-xs text-[#e5e5e5] placeholder:text-[#555]"
              />
              {rundownSearch && (
                <button
                  type="button"
                  onClick={() => setRundownSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-[#666] hover:text-[#e5e5e5]"
                >
                  Clear
                </button>
              )}
            </div>
            {normalizedSearch && (
              <div className="flex items-center justify-between rounded-sm border border-[#2a2a2a] bg-[#0c0c0c] px-2 py-1 text-[10px] uppercase tracking-wider text-[#888]">
                <span className="tabular-nums">
                  {matches.length === 0 ? "0 matches" : `${matchCursor + 1} / ${matches.length}`}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={matches.length === 0}
                    onClick={() => stepMatch(-1)}
                    className="h-6 w-6 rounded-sm hover:bg-[#1a1a1a]"
                    title="Previous match (Shift+Enter)"
                  >
                    <ChevronUp className="h-3 w-3" strokeWidth={1.5} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={matches.length === 0}
                    onClick={() => stepMatch(1)}
                    className="h-6 w-6 rounded-sm hover:bg-[#1a1a1a]"
                    title="Next match (Enter)"
                  >
                    <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
                  </Button>
                </div>
              </div>
            )}

            {!isClient && (
              <div
                className="sticky top-0 z-10 flex flex-wrap items-center gap-1 rounded-sm border border-[#2a2a2a] bg-[#101010]/95 p-1.5 backdrop-blur"
                onPointerDown={protectRundownToolbarSelection}
              >
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 rounded-sm text-[#bbb] hover:bg-[#252525] hover:text-white"
                  onMouseDown={protectRundownToolbarSelection}
                  onClick={() => applyRundownCommand("bold")}
                  title="Bold"
                >
                  <Bold className="h-3.5 w-3.5" strokeWidth={1.5} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 rounded-sm text-[#bbb] hover:bg-[#252525] hover:text-white"
                  onMouseDown={protectRundownToolbarSelection}
                  onClick={() => applyRundownCommand("italic")}
                  title="Italic"
                >
                  <Italic className="h-3.5 w-3.5" strokeWidth={1.5} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 rounded-sm text-[#bbb] hover:bg-[#252525] hover:text-white"
                  onMouseDown={protectRundownToolbarSelection}
                  onClick={() => applyRundownCommand("underline")}
                  title="Underline"
                >
                  <Underline className="h-3.5 w-3.5" strokeWidth={1.5} />
                </Button>
                <Type className="h-3.5 w-3.5 text-[#666]" strokeWidth={1.5} />
                <div className="flex items-center gap-0.5 rounded-sm border border-[#2a2a2a] bg-[#0c0c0c]">
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      protectRundownToolbarSelection(e);
                    }}
                    onClick={(e) => stepRundownFontSize(e, -2)}
                    className="flex h-7 w-6 items-center justify-center text-[#bbb] hover:bg-[#252525] hover:text-white"
                    title="Decrease font size"
                  >
                    <Minus className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                  <Input
                    type="number"
                    min={10}
                    max={400}
                    value={rundownFontSize}
                    onPointerDown={protectRundownToolbarSelection}
                    onMouseDown={protectRundownToolbarSelection}
                    onChange={(e) => setRundownFontSize(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const v = parseInt(rundownFontSize, 10);
                        if (v > 0) applyRundownFontSize(v);
                      }
                    }}
                    className="no-spin h-7 w-11 rounded-none border-0 bg-transparent px-1 text-center text-xs text-[#e5e5e5] focus-visible:ring-0"
                    title="Font size (Enter to apply)"
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      protectRundownToolbarSelection(e);
                    }}
                    onClick={(e) => stepRundownFontSize(e, 2)}
                    className="flex h-7 w-6 items-center justify-center text-[#bbb] hover:bg-[#252525] hover:text-white"
                    title="Increase font size"
                  >
                    <Plus className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-sm px-2 text-[10px] uppercase tracking-wider text-[#888] hover:bg-[#252525] hover:text-white"
                  onMouseDown={protectRundownToolbarSelection}
                  onClick={() => {
                    const v = parseInt(rundownFontSize, 10);
                    if (v > 0) applyRundownFontSize(v);
                  }}
                  title="Apply font size"
                >
                  Set
                </Button>
                <select
                  className="h-7 max-w-[96px] rounded-sm border border-[#2a2a2a] bg-[#0c0c0c] px-1 text-[10px] text-[#bbb]"
                  value=""
                  onPointerDown={protectRundownToolbarSelection}
                  onMouseDown={protectRundownToolbarSelection}
                  onChange={(e) => {
                    if (e.target.value) applyRundownStyle({ fontFamily: e.target.value });
                    e.currentTarget.value = "";
                  }}
                  title="Font family"
                >
                  <option value="">Font…</option>
                  {FONT_FAMILIES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <input
                  type="color"
                  value={rundownTextColor}
                  onPointerDown={protectRundownToolbarSelection}
                  onMouseDown={protectRundownToolbarSelection}
                  onChange={(e) => setRundownTextColor(e.target.value)}
                  onBlur={(e) => applyRundownStyle({ color: e.target.value })}
                  className="h-7 w-7 cursor-pointer rounded-sm border border-[#2a2a2a] bg-transparent"
                  title="Text color (apply on close)"
                />
                <input
                  type="color"
                  value={rundownHighlightColor}
                  onPointerDown={protectRundownToolbarSelection}
                  onMouseDown={protectRundownToolbarSelection}
                  onChange={(e) => setRundownHighlightColor(e.target.value)}
                  onBlur={(e) => applyRundownStyle({ backgroundColor: e.target.value }, "mark")}
                  className="h-7 w-7 cursor-pointer rounded-sm border border-[#2a2a2a] bg-transparent"
                  title="Highlight color (apply on close)"
                />
              </div>
            )}

            <div className="space-y-2">
              {visibleBlocks.map(({ block: b, snippet, index }, vIdx) => {
                const isActiveMatch =
                  normalizedSearch !== "" && matches[matchCursor]?.block.id === b.id;
                return (
                  <div key={b.id + "-wrap"}>
                  {vIdx === 0 && !isClient && normalizedSearch === "" && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); insertBlockAt(0); }}
                      title="Insert block here"
                      className="group mb-1 flex h-4 w-full items-center justify-center opacity-40 hover:opacity-100 transition-opacity"
                    >
                      <span className="h-px flex-1 bg-[#2a2a2a] group-hover:bg-[#0055ff]/60" />
                      <span className="mx-2 flex h-4 w-4 items-center justify-center rounded-full border border-[#2a2a2a] bg-[#0c0c0c] text-[#888] group-hover:border-[#0055ff] group-hover:text-[#ff9a9a]">
                        <Plus className="h-2.5 w-2.5" strokeWidth={2} />
                      </span>
                      <span className="h-px flex-1 bg-[#2a2a2a] group-hover:bg-[#0055ff]/60" />
                    </button>
                  )}
                  <div
                    key={b.id}
                    draggable={draggedId === b.id}
                    onDragOver={onDragOver}
                    onDrop={() => onDrop(b.id)}
                    onDragEnd={() => setDraggedId(null)}
                    onClick={(event) => {
                      setActiveId(b.id);
                      // Never steal focus from an input/contenteditable the user
                      // actually clicked. WebKit applies the row's bubbling click
                      // after the native focus step, so unconditional delegation
                      // here immediately blurred title fields and made them appear
                      // completely non-interactive in a fresh browser session.
                      const target = event.target as HTMLElement;
                      const clickedField = target.closest<HTMLElement>(
                        'input, textarea, select, button, [contenteditable="true"]',
                      );
                      if (!clickedField) {
                        const row = event.currentTarget;
                        const field =
                          row.querySelector<HTMLElement>("[data-rich-editor]") ??
                          row.querySelector<HTMLInputElement>("input[data-block-title]");
                        if (field && document.activeElement !== field) field.focus();
                      }
                      onScrollToBlock?.(
                        b.id,
                        index >= 0
                          ? Math.max(
                              0,
                              Math.min(1, index / Math.max(1, searchableText(b.body || "").length)),
                            )
                          : undefined,
                      );
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onJumpToBlock?.(b.id);
                    }}
                    title="Click to scroll to this block · Double-click to jump in Prompt Mode"
                    data-rundown-row={b.id}
                    className={`rounded-sm border p-2 transition-colors cursor-pointer ${
                      isActiveMatch
                        ? "border-l-2 border-l-[#f5c84b] border-y-[#3a3a2a] border-r-[#3a3a2a] bg-[#1d1a10]"
                        : activeId === b.id
                          ? "border-l-2 border-l-[#0055ff] border-y-[#2a2a2a] border-r-[#2a2a2a] bg-[#1c1c1c]"
                          : "border-[#2a2a2a] bg-[#000000] hover:bg-[#0f0f0f]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        // Only arm row-drag when the user grabs the grip; a
                        // permanently `draggable` ancestor cancels focus on
                        // mousedown inside nested contentEditables, which is
                        // why clicks in blocks 2+ didn't land the caret.
                        className="hidden cursor-grab sm:inline-flex"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setDraggedId(b.id);
                        }}
                        onMouseUp={() => setDraggedId(null)}
                        onDragStart={(e) => {
                          e.stopPropagation();
                          onDragStart(b.id);
                        }}
                      >
                        <GripVertical
                          className="h-3.5 w-3.5 text-[#555]"
                          strokeWidth={1.5}
                        />
                      </span>
                      <div className="flex flex-col">
                        <button
                          type="button"
                          title="Move up"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveBlock(b.id, -1);
                          }}
                          className="flex h-3.5 w-5 items-center justify-center rounded-sm text-[#888] hover:bg-[#252525] hover:text-white"
                        >
                          <ChevronUp className="h-3 w-3" strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          title="Move down"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveBlock(b.id, 1);
                          }}
                          className="flex h-3.5 w-5 items-center justify-center rounded-sm text-[#888] hover:bg-[#252525] hover:text-white"
                        >
                          <ChevronDown className="h-3 w-3" strokeWidth={2} />
                        </button>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-sm hover:bg-[#252525]"
                        title={collapsed[b.id] ? "Expand" : "Collapse"}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCollapsed((c) => ({ ...c, [b.id]: !c[b.id] }));
                        }}
                      >
                        {collapsed[b.id] ? (
                          <ChevronRight className="h-3.5 w-3.5 text-[#888]" strokeWidth={1.5} />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-[#888]" strokeWidth={1.5} />
                        )}
                      </Button>
                      <BlockTitleInput
                        blockId={b.id}
                        value={b.title}
                        readOnly={isClient}
                        onCommit={(title) => updateBlock(b.id, { title })}
                      />
                      {peers
                        .filter((p) => p.editing_block_id === b.id && p.user_id !== selfUserId)
                        .slice(0, 3)
                        .map((p) => (
                          <BlockEditingChip key={p.user_id} peer={p} />
                        ))}
                      {(() => {
                        const vis = getBlockVisibility(b);
                        const next: BlockVisibility =
                          vis === "visible" ? "ghosted" : vis === "ghosted" ? "hidden" : "visible";
                        const label =
                          vis === "visible"
                            ? "Visible — click to Ghost"
                            : vis === "ghosted"
                              ? "Ghosted — click to Hide"
                              : "Hidden — click to Show";
                        const Icon = vis === "visible" ? Eye : vis === "ghosted" ? Ghost : EyeOff;
                        const color =
                          vis === "visible"
                            ? "text-[#888]"
                            : vis === "ghosted"
                              ? "text-[#c8a032]"
                              : "text-[#0055ff]";
                        return (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-sm hover:bg-[#252525]"
                            title={label}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isClient) {
                                toast.error("Client mode: only the host can change visibility");
                                return;
                              }
                              const wasVisible = vis === "visible";
                              const nextGhosted = next === "ghosted" || next === "hidden";
                              updateBlock(b.id, { visibility: next, ghosted: nextGhosted });
                              // Auto-bookmark: when a block becomes ghosted/hidden,
                              // jump the active pointer to the NEXT sequential block
                              // so the operator lands cleanly on the next cue.
                              if (wasVisible && nextGhosted) {
                                const idx = blocks.findIndex((x) => x.id === b.id);
                                const nextBlock = blocks
                                  .slice(idx + 1)
                                  .find((x) => getBlockVisibility(x) === "visible");
                                if (nextBlock) {
                                  setActiveId(nextBlock.id);
                                  toast.success(
                                    `Skipped — bookmarked "${nextBlock.title || "Untitled"}"`,
                                  );
                                }
                              }
                            }}
                          >
                            <Icon className={`h-3.5 w-3.5 ${color}`} strokeWidth={1.5} />
                          </Button>
                        );
                      })()}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-sm hover:bg-[#252525]"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isClient) {
                            toast.error("Client mode: only the host can remove blocks");
                            return;
                          }
                          removeBlock(b.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-[#888]" strokeWidth={1.5} />
                      </Button>
                    </div>
                    {!collapsed[b.id] && (
                      <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                        {snippet && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveId(b.id);
                              onScrollToBlock?.(
                                b.id,
                                Math.max(
                                  0,
                                  Math.min(
                                    1,
                                    index / Math.max(1, searchableText(b.body || "").length),
                                  ),
                                ),
                              );
                            }}
                            className="mb-1.5 block w-full rounded-sm border border-[#2a2a2a] bg-[#101010] px-2 py-1.5 text-left text-[11px] leading-snug text-[#aaa] hover:bg-[#181818] hover:text-[#e5e5e5]"
                          >
                            …
                            <span
                              dangerouslySetInnerHTML={{
                                __html: highlightMatch(snippet, normalizedSearch),
                              }}
                            />
                            …
                          </button>
                        )}
                        {isClient ? (
                          <div className="space-y-1.5">
                            <div
                              className="text-xs rounded-sm border border-[#2a2a2a] bg-[#0a0a0a] p-2.5 text-[#a3a3a3] max-h-[160px] overflow-y-auto"
                              style={{
                                fontFamily: fontFamily || undefined,
                                textTransform: allCaps ? "uppercase" : undefined,
                              }}
                              dangerouslySetInnerHTML={{
                                __html: b.body || "<p><em>(empty)</em></p>",
                              }}
                            />
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDraftBlockId(b.id);
                              }}
                              className="h-7 w-full rounded-sm border border-[#2a2a2a] bg-[#1f1f1f] text-[10px] font-semibold uppercase tracking-wider text-[#e5e5e5] shadow-none hover:bg-[#262626]"
                            >
                              <Send className="mr-1.5 h-3 w-3" strokeWidth={1.5} /> Open Draft
                              Editor
                            </Button>
                          </div>
                        ) : (
                          <RundownEditor
                            blockId={b.id}
                            html={drafts[b.id] !== undefined ? drafts[b.id] : b.body}
                            onChange={(html) => handleBodyChange(b.id, html)}
                            onSelection={rememberRundownSelection}
                            onLocate={(offsetRatio) => {
                              setActiveId(b.id);
                              onScrollToBlock?.(b.id, offsetRatio);
                            }}
                            fontFamily={fontFamily}
                            allCaps={allCaps}
                            resyncKey={drafts[b.id] === undefined ? b.body : undefined}
                          />
                        )}
                        {backupMode && !hostLive && drafts[b.id] !== undefined && drafts[b.id] !== b.body && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingApplyId(b.id);
                              }}
                              className={`h-7 flex-1 rounded-sm border text-[10px] font-semibold uppercase tracking-wider shadow-none ${
                                hostLive
                                  ? "border-[#0055ff]/60 bg-[#0055ff]/15 text-[#8ab0ff] hover:bg-[#0055ff]/25"
                                  : "border-[#2a2a2a] bg-[#1f1f1f] text-[#e5e5e5] hover:bg-[#262626]"
                              }`}
                              title="Push this edit to the host"
                            >
                              <Send className="mr-1.5 h-3 w-3" strokeWidth={1.5} /> Push to host
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                discardDraft(b.id);
                              }}
                              className="h-7 rounded-sm text-[10px] uppercase tracking-wider text-[#888] hover:bg-[#1a1a1a]"
                            >
                              Discard
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {!isClient && normalizedSearch === "" && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); insertBlockAt(vIdx + 1); }}
                      title="Insert block here"
                      className="group mt-1 flex h-4 w-full items-center justify-center opacity-40 hover:opacity-100 transition-opacity"
                    >
                      <span className="h-px flex-1 bg-[#2a2a2a] group-hover:bg-[#0055ff]/60" />
                      <span className="mx-2 flex h-4 w-4 items-center justify-center rounded-full border border-[#2a2a2a] bg-[#0c0c0c] text-[#888] group-hover:border-[#0055ff] group-hover:text-[#ff9a9a]">
                        <Plus className="h-2.5 w-2.5" strokeWidth={2} />
                      </span>
                      <span className="h-px flex-1 bg-[#2a2a2a] group-hover:bg-[#0055ff]/60" />
                    </button>
                  )}
                  </div>
                );
              })}
              {!isClient && (
                <Button
                  onClick={addBlock}
                  title="Add a new block at the end (⌘/Ctrl+Shift+B)"
                  className="mt-2 h-10 w-full rounded-sm border border-dashed border-[#0055ff]/50 bg-transparent text-xs font-semibold uppercase tracking-wider text-[#ff9a9a] shadow-none hover:bg-[#0055ff]/15 hover:text-white"
                  variant="outline"
                >
                  <Plus className="mr-1.5 h-4 w-4" strokeWidth={2} /> Add Block
                </Button>
              )}
            </div>
          </div>

          <AlertDialog open={!!pendingApplyId} onOpenChange={(o) => !o && setPendingApplyId(null)}>
            <AlertDialogContent className="border-[#2a2a2a] bg-[#141414] text-[#e5e5e5]">
              <AlertDialogHeader>
                <AlertDialogTitle className={hostLive ? "text-[#8ab0ff]" : "text-[#e5e5e5]"}>
                  {hostLive ? "Whoa there!!" : "Um, You suuure?"}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-[#bbb]">
                  {hostLive
                    ? "Your host is in prompt mode — this may throw them!"
                    : "You're changing the entire script."}
                  {pendingBlock && (
                    <span className="mt-2 block text-[11px] uppercase tracking-wider text-[#888]">
                      Block: <span className="text-[#e5e5e5]">{pendingBlock.title}</span>
                    </span>
                  )}
                  <span className="mt-2 block text-[11px] text-[#666]">
                    The host's scroll position won't change — only the block content.
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-[#2a2a2a] bg-transparent text-[#e5e5e5] hover:bg-[#1a1a1a]">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (pendingApplyId) applyDraft(pendingApplyId);
                    setPendingApplyId(null);
                  }}
                  className={
                    hostLive
                      ? "bg-[#0055ff] text-white hover:bg-[#a82828]"
                      : "bg-[#1f1f1f] text-[#e5e5e5] hover:bg-[#262626] border border-[#2a2a2a]"
                  }
                >
                  {hostLive ? "Push anyway" : "Ah, push it"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {draftBlock && registerAckListener && onSendProposeChange && (
            <DraftEditorDialog
              open={!!draftBlockId}
              onOpenChange={(o) => {
                if (!o) setDraftBlockId(null);
              }}
              blockTitle={draftBlock.title}
              initialHtml={draftBlock.body}
              onEditingChange={(editing) => onSetEditingBlock?.(editing ? draftBlock.id : null)}
              registerAckListener={registerAckListener}
              onPush={(html, changeId) => {
                onSendProposeChange({
                  change_id: changeId,
                  block_id: draftBlock.id,
                  html,
                  from_user: { id: selfUserId ?? "anon", name: selfUserName },
                });
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

function RundownEditor({
  blockId,
  html,
  onChange,
  onSelection,
  onLocate,
  fontFamily,
  allCaps,
  resyncKey,
}: {
  blockId: string;
  html: string;
  onChange: (html: string) => void;
  onSelection?: () => void;
  onLocate?: (offsetRatio: number) => void;
  fontFamily?: string;
  allCaps?: boolean;
  /** When this prop changes, re-sync editor content from `html` (used to revert drafts). */
  resyncKey?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Set initial content ONCE. Never re-set innerHTML on every keystroke —
  // doing so resets the caret to the start, which makes typed text appear
  // reversed and out of order.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (html || "")) {
      ref.current.innerHTML = normalizeBookmarkHtml(html || "");
      normalizeBookmarkElementText(ref.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the parent replaces the html externally (e.g. Load), sync without
  // clobbering the caret while the user is actively typing in this node.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return; // user is typing — don't disturb
    const normalized = normalizeBookmarkHtml(html || "");
    if (el.innerHTML !== normalized) {
      el.innerHTML = normalized;
      normalizeBookmarkElementText(el);
    }
  }, [html, resyncKey]);

  return (
    <div
      ref={ref}
      data-rich-editor=""
      data-block-id={blockId}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      draggable={false}
      className="text-xs rounded-b-md border-0 bg-white/5 p-2.5 min-h-[72px] max-h-[280px] overflow-y-auto text-[#e5e5e5] focus:outline-none focus:bg-white/[0.07] transition-colors"
      style={{
        fontFamily: fontFamily || undefined,
        textTransform: allCaps ? "uppercase" : undefined,
      }}
      onMouseDown={(e) => {
        // The parent block row is `draggable`, which on some browsers hijacks
        // clicks inside a nested contentEditable and prevents the caret from
        // landing — the editor never actually gets focus so keystrokes go
        // nowhere. Stop the mousedown and any drag from bubbling so the
        // native contentEditable focus/selection can run.
        e.stopPropagation();
      }}
      onDragStart={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onClick={(e) => {
        e.stopPropagation();
        const el = ref.current;
        if (!el) return;
        if (document.activeElement !== el) el.focus();
        const rect = el.getBoundingClientRect();
        const y = e.clientY - rect.top + el.scrollTop;
        const ratio = Math.max(0, Math.min(1, y / Math.max(1, el.scrollHeight)));
        onLocate?.(ratio);
      }}
      onInput={(e) => {
        const el = e.target as HTMLDivElement;
        normalizeBookmarkElementText(el);
        onChange(el.innerHTML);
      }}
      onKeyUp={onSelection}
      onMouseUp={onSelection}
      onSelect={onSelection}
      onBlur={onSelection}
    />
  );
}

/**
 * Isolated, memoized title input.
 * - Keeps a local buffer so keystrokes never depend on the parent's re-render cycle
 *   (fixes the "focus drops after every character" bug caused by upstream state churn).
 * - Debounces the commit back to the canonical `blocks` state (300ms), and always
 *   flushes on blur so nothing is lost.
 * - Auto-focuses when mounted for the first time after a new block is created —
 *   the parent renders freshly-added blocks so the `autoFocus` fires on mount.
 */
interface BlockTitleInputProps {
  blockId: string;
  value: string;
  readOnly?: boolean;
  onCommit: (title: string) => void;
}

const BlockTitleInput = memo(function BlockTitleInput({
  blockId,
  value,
  readOnly,
  onCommit,
}: BlockTitleInputProps) {
  const [local, setLocal] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(local);
  latestRef.current = local;

  // Sync external updates (e.g. remote collab, undo) but only when the user
  // is NOT actively editing — otherwise we'd yank the caret out.
  useEffect(() => {
    const el = inputRef.current;
    const isFocused = el && document.activeElement === el;
    if (!isFocused && value !== latestRef.current) {
      setLocal(value);
    }
  }, [value]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (latestRef.current !== value) onCommit(latestRef.current);
  }, [onCommit, value]);

  return (
    <Input
      ref={inputRef}
      value={local}
      readOnly={readOnly}
      data-block-title={blockId}
      onChange={(e) => {
        const next = e.target.value;
        setLocal(next);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (latestRef.current !== value) onCommit(latestRef.current);
        }, 300);
      }}
      onBlur={flush}
      onClick={(e) => {
        e.stopPropagation();
        if (document.activeElement !== e.currentTarget) e.currentTarget.focus();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          flush();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="h-7 rounded-sm border-transparent bg-transparent px-1 text-xs font-medium uppercase tracking-wider text-[#e5e5e5] hover:border-[#2a2a2a] focus:border-[#3a3a3a]"
    />
  );
});


/** Perf: the rundown sidebar must not reconcile on every keystroke in the
 *  editor canvas — only when its own props actually change. */
export const Rundown = memo(RundownImpl);
