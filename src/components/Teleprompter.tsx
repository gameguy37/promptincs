import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Rundown, stripStylePropsFromTree, type ScriptBlock } from "./Rundown";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { getEditorExtensions, sharedEditorProps } from "@/lib/tiptap/editorConfig";
import {
  useTeleprompterSync,
  type SyncRole,
  type PrompterState,
  type DisplayPayload,
  type BlocksPayload,
  type InitialSyncPayload,
  type PresenceMeta,
  type AckPayload,
  type ProposeChangePayload,
  type PermissionsMap,
  type ParticipantPermissions,
  DEFAULT_OBSERVE_PERMISSIONS,
  HOST_PERMISSIONS,
} from "@/hooks/useTeleprompterSync";
import { useAuth, colorForUserId } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSessionLobby } from "@/hooks/useSessionLobby";
import {
  BOOKMARK_TEXT,
  normalizeBookmarkElementText,
  normalizeBookmarkHtml,
} from "@/lib/bookmarks";
import {
  clearRangeHighlight,
  cssEscape,
  paintRangeHighlight,
  rangeToTextOffsets,
  textOffsetsToRange,
  type SavedTextSelection,
} from "@/lib/selectionMemory";
import { PresenceBar, BlockEditingChip } from "./PresenceBar";
import { StagePip, defaultPipConfig, type PipConfig } from "./StagePip";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Bold,
  CaseUpper,
  ExternalLink,
  Eye,
  EyeOff,
  Italic,
  Pencil,
  Radio,
  Settings,
  Type,
  Underline,
  Wifi,
  WifiOff,
  Copy,
  AlertTriangle,
  Sparkles,
  ChevronUp,
  ChevronDown,
  X,
  Bookmark,
  BookmarkPlus,
  Search,
  Sliders,
  LogOut,
  ZoomIn,
  ZoomOut,
  Printer,
  Timer as TimerIcon,
  Clock3,
  Users,
} from "lucide-react";
import { Highlighter } from "lucide-react";
import { Volume2, Square as SquareIcon } from "lucide-react";
import { RotateCcw, FolderOpen, Save, Pilcrow, FileUp, PackageOpen } from "lucide-react";
import { RefreshCw } from "lucide-react";
import { Pen, Eraser, MousePointer2, Trash2 } from "lucide-react";
import { Minus as MinusIcon, Plus as PlusIcon } from "lucide-react";
import {
  AnnotationLayer,
  type Annotation,
  type AnnotationTool,
  type BlockOffset,
} from "./AnnotationLayer";
import { MarginRuler } from "./MarginRuler";
import { exportShowPdf, exportPromptinc } from "@/lib/exportRundown";
import { OperatorHUD } from "./OperatorHUD";
import { RemoteEditTally } from "./RemoteEditTally";
import { isImportableScriptFile, parseScriptFile } from "@/lib/importScript";
import { normalizeScriptHtml } from "@/lib/normalizeScript";
import { buildPromptSession, exportPromptFile, importPromptFile, isPromptFile } from "@/lib/promptSession";
import {
  clearRecoverySnapshot,
  loadRecoverySnapshot,
  markRecoveryDismissed,
  saveRecoverySnapshot,
  wasRecoveryDismissed,
} from "@/lib/crashRecovery";
import { QRCodeSVG } from "qrcode.react";
import { StageTimer } from "./StageTimer";
import { LunarLander } from "./LunarLander";
import * as Y from "yjs";
import type { Doc as YDoc } from "yjs";
import { SupabaseYjsProvider } from "@/lib/collab/SupabaseYjsProvider";
import { IndexeddbPersistence } from "y-indexeddb";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import { useElectronMenu } from "@/hooks/useElectronMenu";
import { useElectronFormatMenu, type FormatCommand } from "@/hooks/useElectronFormatMenu";
import { useLicense } from "@/lib/license";
import { LicenseModal, TrialExpiredScreen } from "./LicenseModal";
import { LoginScreen } from "./LoginScreen";

const STORAGE_BLOCKS = "tp.blocks.v3";
const STORAGE_ACTIVE = "tp.active.v2";
const STORAGE_SETTINGS = "tp.settings.v2";
const STORAGE_PIN = "tp.pin.v1";
const STORAGE_ANNOTATIONS = "tp.annotations.v1";

/** The default eyeline marker is the soft, "bubbly" rounded arrow rendered by
 *  <BubblyArrow/>. It is identified by the sentinel "▶"; every other option is
 *  a literal glyph/emoji rendered as text. */
const DEFAULT_MARKER = "▶";
const MARKER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: DEFAULT_MARKER, label: "Bubbly" },
  { value: "👉", label: "Point" },
  { value: "🚀", label: "Rocket" },
  { value: "💀", label: "Skull" },
  { value: "✕", label: "X" },
];

/** Softly rounded, "bubbly" eyeline arrow. Rounded corners come from a thick
 *  round-joined stroke in the same fill color, so it reads as one solid shape. */
function BubblyArrow({ size = 40, color = "#ffffff" }: { size?: number; color?: string }) {
  const h = Math.round(size * 0.85);
  const inset = Math.max(3, Math.round(size * 0.16));
  const points = `${inset},${inset} ${inset},${h - inset} ${size - inset},${h / 2}`;
  return (
    <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} aria-hidden>
      <polygon
        points={points}
        fill={color}
        stroke={color}
        strokeWidth={inset * 2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

const PIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generatePin(): string {
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += PIN_ALPHABET[Math.floor(Math.random() * PIN_ALPHABET.length)];
  }
  return out;
}
function normalizePin(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

/** Invert a 6-digit hex color (e.g. #000000 -> #ffffff). */
function invertHexColor(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#ffffff";
  const r = (255 - parseInt(clean.substring(0, 2), 16)).toString(16).padStart(2, "0");
  const g = (255 - parseInt(clean.substring(2, 4), 16)).toString(16).padStart(2, "0");
  const b = (255 - parseInt(clean.substring(4, 6), 16)).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

/** Short numeric admission code (4 digits) shown to the host and required by
 *  remote users at the Lobby gate. */
function generateNumericPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

const LOBBY_ROLES = ["Producer", "Writer", "Second Op"] as const;

/**
 * Resolve the active room/session id from the URL. Supports both the legacy
 * query-string form (`?room=` / `?pin=`) and the Play Along Room path form
 * (`/play/<sessionId>`).
 */
function roomFromLocation(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  let room = params.get("room") ?? params.get("pin") ?? "";
  if (!room) {
    const m = window.location.pathname.match(/\/(?:play|follow)\/([^/?#]+)/);
    if (m) room = decodeURIComponent(m[1]);
  }
  return normalizePin(room);
}

const defaultBlocks: ScriptBlock[] = [
  {
    id: "welcome",
    title: "Block 1",
    body: "<p></p>",
  },
];

type Mode = "edit" | "prompt";

interface PrompterSettings {
  // Eyeline
  showArrow: boolean;
  showGuide: boolean;
  triangleSize: number;
  triangleColor: string;
  eyelineY: number;
  /** When true, mirror the Prompt-Mode eyeline marker onto the right edge
   *  of the viewport as well. Default off — arrow lives on the left only. */
  mirrorArrow: boolean;
  // Layout
  marginH: number; // %
  marginV: number; // vh
  /** Show the Word-style draggable margin ruler at the top of Edit Mode. */
  showRuler: boolean;
  /** Snap ruler handle drags to the ruler's 5% tick marks. */
  rulerSnap: boolean;
  /** Show the floating annotate (pencil) launcher. */
  showAnnotateButton: boolean;
  /** When false, tapping into the script on a touch device places the caret
   *  without summoning the on-screen keyboard; a floating ⌨ button brings it
   *  up on demand. When true (default) the keyboard behaves natively. */
  autoKeyboard: boolean;
  align: "left" | "center" | "right";
  // Text
  allCaps: boolean;
  fontFamily: string;
  /** Base canvas font size in px. Inline <span style="font-size:..."> from
   *  per-selection edits override this for individual runs. */
  fontSize: number;
  lineHeight: number;
  bgColor: string;
  // Display flips (only applied to extended display)
  flipH: boolean;
  flipV: boolean;
  // Misc
  showTimer: boolean;
  // Sync the extended display scroll to the host's text cursor in edit mode
  snapToCursor: boolean;
  // Render the rundown block title (e.g. "Block 1 — Cold Open") above each
  // block in both Edit and Prompt mode so the host can keep their place.
  showHeadings: boolean;
  /** Encoder tuning — dedicated to hardware encoders / remotes emulating
   *  ArrowLeft / ArrowRight. Deadzone rejects tiny jitter ticks; ramp
   *  controls how quickly successive ticks accelerate the scroll speed. */
  encoderDeadzoneMs: number;
  encoderRepeatThresholdMs: number;
  encoderRampMs: number;
  /** Scroll inertia (LERP friction) — the fraction of the remaining gap
   *  between target and current velocity that is closed each animation
   *  frame. 1.0 = instant/jerky, 0.05 = very sluggish. Default ~0.15 gives
   *  a subtle smooth deceleration when the encoder reverses direction. */
  scrollInertia: number;
  /** Optional static picture-in-picture reminder card (e.g. "You're in
   *  Atlantic City, NJ!"). Draggable + resizable; local-only, never
   *  broadcast to remote clients. */
  pip: PipConfig;
}

const defaultSettings: PrompterSettings = {
  showArrow: true,
  showGuide: false,
  triangleSize: 40,
  triangleColor: "#ffffff",
  eyelineY: 0.5,
  mirrorArrow: false,
  marginH: 12,
  marginV: 50,
  showRuler: true,
  rulerSnap: false,
  showAnnotateButton: true,
  autoKeyboard: true,
  align: "left",
  allCaps: false,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: 96,
  lineHeight: 1.2,
  bgColor: "#000000",
  flipH: false,
  flipV: false,
  showTimer: false,
  snapToCursor: true,
  showHeadings: true,
  encoderDeadzoneMs: 0,
  encoderRepeatThresholdMs: 180,
  encoderRampMs: 900,
  scrollInertia: 0.08,
  pip: defaultPipConfig,
};

// Scroll velocity is expressed in pixels per animation frame (~60fps).
// Arrow keys nudge the velocity in discrete steps so taps are predictable
// and holding a key can't snowball into runaway acceleration.
const MAX_SPEED = 20;
const ACCELERATION_STEP = 1;
const REPEAT_ACCELERATION_STEP = 0.25;
// When an encoder / remote emulates the arrow keys it fires many discrete
// non-repeat presses in quick succession. Treat those bursts like a "hold"
// and accelerate in smaller sub-steps so the ramp feels smooth instead of
// stair-stepping toward MAX_SPEED. A real keyboard tap has a much larger
// gap between presses and still gets the full ACCELERATION_STEP kick.
// Reference values: a well-tuned encoder ticks at roughly this cadence, so
// mapping ramp-time → per-tick step size stays intuitive. Users adjust the
// ramp via `encoderRampMs`; smaller ramp = faster acceleration.
const ENCODER_ASSUMED_TICK_MS = 40;
const ENCODER_MIN_STEP = 0.08;
const ENCODER_MAX_STEP = 1.2;
const clampNum = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
const DEFAULT_FONT_SIZE = 96;
/** Phones can't carry a 96px broadcast face — boot them at a readable size. */
const MOBILE_FONT_SIZE = 48;
const MOBILE_BREAKPOINT = 768;
/** True when the *current* screen is a phone-class viewport. */
function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT;
}
/** Device-scoped default so a phone never inherits the desktop's 96pt. */
function initialFontSize(): number {
  return isMobileViewport() ? MOBILE_FONT_SIZE : DEFAULT_FONT_SIZE;
}
/** Separate persistence slots per device class. */
function fontSizeStorageKey(): string {
  return isMobileViewport() ? "prompter_fontSize_mobile" : "prompter_fontSize_desktop";
}
/**
 * Master canvas width. Both Edit Mode and Prompt Mode lay their text out
 * inside an element of EXACTLY this many CSS pixels wide. The element is
 * then `zoom`-scaled to fit whatever physical screen is displaying it, which
 * guarantees identical line breaks across the operator laptop, the extended
 * display, and any client window.
 */
const CANVAS_WIDTH = 1920;
/** Edit View Toggle: how much the on-screen font shrinks while editing.
 *  Pure font-size math — never a CSS transform, and never applied in Prompt
 *  Mode (the broadcast output always renders at 100% of the user font size). */
const EDIT_ZOOM_FACTOR = 0.3;
/** Uniform vertical gap between rundown blocks. Applied identically to the
 *  Edit-mode flow and the Prompt-mode canvas so blocks stack tightly without
 *  looking like a blank line was inserted between them. */
const BLOCK_GAP = "0.5em";

const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: "System", value: "system-ui, -apple-system, sans-serif" },
  { label: "Helvetica", value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Times", value: "'Times New Roman', Times, serif" },
  { label: "Courier", value: "'Courier New', Courier, monospace" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Trebuchet", value: "'Trebuchet MS', sans-serif" },
  { label: "Impact", value: "Impact, Charcoal, sans-serif" },
  { label: "Comic Sans", value: "'Comic Sans MS', cursive" },
];

function legacyToHtml(body: string, bookmarks?: number[]): string {
  if (/<[a-z][\s\S]*>/i.test(body)) return body;
  const bms = (bookmarks ?? []).filter((n) => n >= 0 && n <= body.length).sort((a, b) => a - b);
  let out = "";
  let prev = 0;
  let i = 0;
  for (const off of bms) {
    out += escapeHtml(body.slice(prev, off)) + `<span data-bookmark="${++i}"></span>`;
    prev = off;
  }
  out += escapeHtml(body.slice(prev));
  return out
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function migrateBlocks(blocks: ScriptBlock[]): ScriptBlock[] {
  return blocks.map((b) => ({
    ...b,
    body: legacyToHtml(b.body ?? "", b.bookmarks),
    bookmarks: undefined,
  }));
}

const PROMPT_NODE_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, div";
const MAIN_SELECTION_HIGHLIGHT = "tp-main-selection-memory";

function ensurePromptNodeIds(html: string, blockId: string): string {
  if (typeof document === "undefined") return html;
  const template = document.createElement("template");
  template.innerHTML = html || "<p></p>";
  const nodes = Array.from(template.content.querySelectorAll<HTMLElement>(PROMPT_NODE_SELECTOR));
  if (nodes.length === 0) {
    const p = document.createElement("p");
    p.setAttribute("data-prompt-node-id", `${blockId}-p-0`);
    p.innerHTML = html || "&nbsp;";
    return p.outerHTML;
  }
  nodes.forEach((node, index) => {
    if (!node.getAttribute("data-prompt-node-id")) {
      node.setAttribute("data-prompt-node-id", `${blockId}-p-${index}`);
    }
  });
  return template.innerHTML;
}

interface TeleprompterProps {
  /** When true, this instance is a slave display: forced client + prompt mode + apply flips. */
  displayOnly?: boolean;
}

export function Teleprompter({ displayOnly = false }: TeleprompterProps) {
  const { user: authUser, signOut } = useAuth();
  // Local-First: reactive `navigator.onLine`. Drives the Host toolbar
  // "OFFLINE" badge and gates Play Along network actions (Copy Link, Admit)
  // that require a live cloud channel to be meaningful.
  const isOnline = useOnlineStatus();
  // Local Trial & License. `license.status` drives the toolbar badge and the
  // Trial-Expired lock; the master key unlocks lifetime use.
  const license = useLicense();
  const [licenseOpen, setLicenseOpen] = useState(false);
  // Client-only badges (online status, license countdown) must not render
  // during SSR — their values differ between server and client.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  // Optional cloud sign-in overlay (Google). Rendered on demand from the
  // toolbar "Connect to Cloud" button, or when a host action requires auth.
  const [signInOpen, setSignInOpen] = useState(false);
  // Guest producer identity: when the page is opened via a `?room=` test link
  // and there is no signed-in account, synthesize a stable per-tab identity so
  // the operator sees a *distinct* second person (presence dedupes by user_id,
  // so two tabs of the same account would otherwise collapse into one avatar).
  const [guestUser] = useState<ReturnType<typeof useAuth>["user"]>(() => {
    if (typeof window === "undefined" || displayOnly) return null;
    // Local-first: synthesize a stable per-browser identity whenever the user
    // isn't signed in, not just for `?room=` links. This lets the whole app
    // work anonymously and offline; cloud sign-in only gates hosting a Play
    // Along Room (see handleCreateSession / handleCreateTestRoom).
    const room = roomFromLocation();
    const KEY = room ? "tp_guest_identity" : "tp_local_identity";
    const storage = room ? sessionStorage : localStorage;
    try {
      const existing = storage.getItem(KEY);
      if (existing) return JSON.parse(existing);
    } catch {
      /* ignore */
    }
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `guest-${Math.random().toString(36).slice(2, 10)}`;
    const label = room ? "Player" : "Local User";
    const obj = { id, name: `${label} ${id.slice(0, 4)}`, email: "", avatar_url: null };
    try {
      storage.setItem(KEY, JSON.stringify(obj));
    } catch {
      /* ignore */
    }
    return obj;
  });
  const user = authUser ?? guestUser;
  const [mounted, setMounted] = useState(false);
  const [blocks, setBlocks] = useState<ScriptBlock[]>(defaultBlocks);
  const [activeId, setActiveId] = useState<string | null>(defaultBlocks[0].id);
  const [mode, setMode] = useState<Mode>(displayOnly ? "prompt" : "edit");
  const [arrowMenuOpen, setArrowMenuOpen] = useState(false);
  const [role, setRole] = useState<SyncRole>(() => {
    if (displayOnly) return "client";
    if (typeof window !== "undefined") {
      if (roomFromLocation()) return "client";
    }
    return "host";
  });
  const [speed, setSpeed] = useState(0);
  const isMobile = useIsMobile();
  /** Virtual Rollerball position (mobile prompt-mode scroll fader). */
  const [rollerValue, setRollerValue] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  // Lazy initializer so the very first paint already carries the device's
  // font size — no flash of giant text on phones.
  const [settings, setSettings] = useState<PrompterSettings>(() => ({
    ...defaultSettings,
    fontSize: initialFontSize(),
  }));
  const [textColor, setTextColor] = useState("#ffffff");
  const [highlightColor, setHighlightColor] = useState("#fde047");
  const [colorScope, setColorScope] = useState<"text" | "highlight" | "background">("text");
  const [blank, setBlank] = useState(false);
  /** Drag-and-drop script import affordance. */
  const [dropActive, setDropActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tieDye, setTieDye] = useState(false);
  const [timerStart] = useState<number>(() => Date.now());
  const [timerNow, setTimerNow] = useState<number>(Date.now());

  // ---- Session PIN (room name) ----
  const initialPin = (() => {
    if (typeof window === "undefined") return null;
    return roomFromLocation() || null;
  })();
  // A remote user arriving via a /follow link must clear the Lobby gate BEFORE
  // we connect them to the live document. We therefore hold the room id in
  // `sessionId` and keep `pin` null (= not connected) until the host admits
  // them. Extended display (`displayOnly`) and host sessions connect directly.
  const isLobbyArrival = !displayOnly && !!initialPin;
  const [sessionId, setSessionId] = useState<string | null>(initialPin);
  const [admitted, setAdmitted] = useState<boolean>(!isLobbyArrival);
  const [pin, setPin] = useState<string | null>(
    isLobbyArrival ? null : initialPin,
  );
  /** Host-generated 4-digit numeric admission code shown in the control panel. */
  const [sessionPin, setSessionPin] = useState<string | null>(null);
  /** Lobby form state (remote arrival). */
  const [lobbyName, setLobbyName] = useState("");
  const [lobbyRole, setLobbyRole] = useState("Producer");
  const [lobbyPinInput, setLobbyPinInput] = useState("");
  /** This user's display name + role used for multiplayer cursor labels. */
  const [selfRoleLabel, setSelfRoleLabel] = useState<string>("");
  const [joinInput, setJoinInput] = useState("");
  const [hostLost, setHostLost] = useState(false);
  const [pinCopied, setPinCopied] = useState(false);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [newShowOpen, setNewShowOpen] = useState(false);
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarH, setToolbarH] = useState(0);
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setToolbarH(el.getBoundingClientRect().height));
    ro.observe(el);
    setToolbarH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [toolbarHidden]);
  const [fontSizeInput, setFontSizeInput] = useState<string>(() => String(initialFontSize()));
  /** Operator HUD visibility (double-click the HUD or press `H`). */
  const [isHudVisible, setIsHudVisible] = useState(true);
  /** Title of the block currently under the eyeline in prompt mode. Derived
   *  from scrollY against the rendered block headings; powers the small HUD
   *  indicator in the bottom-left corner. */
  const [visibleBlockTitle, setVisibleBlockTitle] = useState<string>("");

  // ---- Annotation layer (pen / highlighter / sticky text over the script) ----
  const [annotations, setAnnotations] = useState<Annotation[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_ANNOTATIONS);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as Annotation[]) : [];
    } catch {
      return [];
    }
  });
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>("off");
  const [annotationColor, setAnnotationColor] = useState("#0055ff");
  const [annotationSize, setAnnotationSize] = useState(4);
  const [annotationOpacity, setAnnotationOpacity] = useState(1);
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [annotationBarOpen, setAnnotationBarOpen] = useState(false);
  const [blockOffsets, setBlockOffsets] = useState<Map<string, BlockOffset>>(new Map());

  // Esc always drops back to the inert "off" tool so the annotation overlay
  // stops swallowing clicks on the script.
  useEffect(() => {
    if (annotationTool === "off") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAnnotationTool("off");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [annotationTool]);

  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  /** Host: exact editor container dimensions, broadcast to remote viewers so
   *  they can letterbox-mirror the host's viewport like a screenshare. */
  const [hostViewport, setHostViewport] = useState<{ width: number; height: number } | null>(null);
  /** Viewer: physical screen box used for the scale-to-fit math. */
  const [viewerScreen, setViewerScreen] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  /** Wrapper that carries the rigid CSS transform scale (never font-size). */
  const scaleWrapperRef = useRef<HTMLDivElement>(null);
  /** Live mirror of the total applied transform scale, for offsetTop math. */
  const totalScaleRef = useRef(1);
  /** Unscaled (natural) height of the fixed-width master canvas. */
  const [canvasNaturalHeight, setCanvasNaturalHeight] = useState(0);
  const markerTrackRef = useRef<HTMLDivElement>(null);
  const editArrowRef = useRef<HTMLDivElement>(null);
  /**
   * Fixed-Width Scaling: both Edit Mode and Prompt Mode render into a single
   * hardcoded-width canvas (CANVAS_WIDTH px). The container's actual width is
   * watched with a ResizeObserver and the canvas is `zoom`-scaled to fit, so
   * line wrapping is byte-identical across the operator's laptop and the
   * extended display regardless of physical screen size.
   */
  const [canvasScale, setCanvasScale] = useState(1);
  const editorRef = useRef<HTMLDivElement>(null);
  /** Map of blockId -> contentEditable element for the continuous edit canvas. */
  const editorsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  /** Map of blockId -> TipTap editor instance (command routing). */
  const tiptapEditorsRef = useRef<Map<string, Editor>>(new Map());
  /** The block whose editor most recently held focus (drives persist target). */
  const activeEditorBlockIdRef = useRef<string | null>(null);
  /** Pending sidebar/jump-to-block scroll request in Edit mode. */
  const pendingEditScrollRef = useRef<{ id: string; offsetRatio?: number } | null>(null);
  const scrollYRef = useRef(0);
  // Last scroll value we actually wrote to the prompter transform. Lets the
  // RAF loop skip DOM writes while the prompter is paused/idle.
  const lastTransformYRef = useRef<number | null>(null);
  const speedRef = useRef(0);
  /** Actual applied scroll velocity — LERPs toward `speedRef` (the target
   *  set by the encoder / keyboard / remote) each frame so rapid reversals
   *  don't cause the text to jerk. See the RAF loop for the friction math. */
  const currentSpeedRef = useRef(0);
  /** Dampened stage between the raw target velocity (`speedRef`) and the
   *  applied velocity (`currentSpeedRef`). Gives the encoder/arrow input a
   *  heavier, softer feel: the target itself eases instead of stepping. */
  const smoothedTargetRef = useRef(0);
  /** Mirror of `settings.scrollInertia` reachable from the RAF loop without
   *  re-subscribing the loop on every settings change. */
  const scrollInertiaRef = useRef(defaultSettings.scrollInertia);
  /** Same-machine dual-window sync: the operator's Prompt Mode window is the
   *  master and the `/display` extended window is the slave. We broadcast a
   *  normalized (0..1) scroll percentage over a BroadcastChannel every frame
   *  the position changes, so the extended monitor tracks the operator's
   *  scroll at 60fps with zero network round-trip. Realtime is still the
   *  cross-machine transport; this channel is a same-origin fast path. */
  const displaySyncChannelRef = useRef<BroadcastChannel | null>(null);
  const lastBroadcastPctRef = useRef<number>(-1);
  /** Live mirror of the full settings object for read-only access from event
   *  handlers / RAF loops that must not re-subscribe on every settings tweak.
   *  Kept fresh via the render-phase assignment just below (see Hydrate). */
  const settingsRef = useRef<PrompterSettings>(defaultSettings);
  const lastArrowPressRef = useRef<{ time: number; dir: -1 | 0 | 1 }>({
    time: 0,
    dir: 0,
  });
  const blankRef = useRef(false);
  const tieDyeRef = useRef(false);
  const modeRef = useRef<Mode>(mode);
  const roleRef = useRef<SyncRole>(role);
  /** Latest resolved permissions for THIS user — read inside event listeners
   *  without re-binding them (keeps Yjs cursor + editor engine lag-free). */
  const selfPermissionsRef = useRef<ParticipantPermissions>(DEFAULT_OBSERVE_PERMISSIONS);
  /** Throttle so a locked user spamming keys/scroll only sees one toast. */
  const lastLockToastRef = useRef(0);
  /** Latest host view state (Edit vs Prompt) as seen by a remote client. Drives
   *  the "host is live in prompt mode" danger warning. */
  const hostModeRef = useRef<Mode>("edit");
  /** Remote-editor warning gates (Play Along Room collaborators only). */
  const [firstEditWarnOpen, setFirstEditWarnOpen] = useState(false);
  const [promptDangerOpen, setPromptDangerOpen] = useState(false);
  const [promptDangerDontShow, setPromptDangerDontShow] = useState(false);
  const hasAckFirstEditRef = useRef(false);
  const promptDangerSuppressedRef = useRef(false);
  /** Host 'Kill Switch' terminated screen (host closed the room). */
  const [roomTerminated, setRoomTerminated] = useState(false);
  /** True when this client was individually kicked (vs the whole room closing). */
  const [terminatedByKick, setTerminatedByKick] = useState(false);
  const keysRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: false });
  const lastRangeRef = useRef<Range | null>(null);
  /** Separate non-collapsed editor selection used by toolbar controls. Focusable
   *  controls (number inputs/selects) collapse the live browser selection, so
   *  keep the last real text selection independent from the caret range. */
  const formatRangeRef = useRef<Range | null>(null);
  const formatSelectionRef = useRef<SavedTextSelection | null>(null);
  const savedSelectionRef = useRef<SavedTextSelection | null>(null);
  const toolbarSelectionGuardRef = useRef(false);
  const pendingBookmarkRef = useRef<string | null>(null);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  /** Custom Prompt Mode read-line indicator. Defaults to the Tandy red
   *  triangle; users can type any glyph or emoji (👉 🚀 💀) into the toolbar
   *  input and it mirrors on both edges of the prompter canvas. */
  const [eyelineMarker, setEyelineMarker] = useState("▶");
  /** Whether the PROMPT MODE CONFIG marker picker popover is open. */
  const [markerPickerOpen, setMarkerPickerOpen] = useState(false);
  /** Show the "Live Edit Received" tally while in Prompt Mode (persisted). */
  const [tallyInPrompt, setTallyInPrompt] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("trs1-tally-in-prompt") === "0") setTallyInPrompt(false);
    } catch { /* storage blocked */ }
  }, []);
  const toggleTallyInPrompt = useCallback(() => {
    setTallyInPrompt((v) => {
      const next = !v;
      try { localStorage.setItem("trs1-tally-in-prompt", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  /** Participants & Permissions console (host only). */
  const [participantsOpen, setParticipantsOpen] = useState(false);
  /** Toolbar "Connected" pill dropdown (safe disconnect menu). */
  const [connectionMenuOpen, setConnectionMenuOpen] = useState(false);
  /** Newly admitted lobby identities stay visible immediately while their room
   *  presence/Yjs connection finishes subscribing. */
  const [admittedLobbyPlayers, setAdmittedLobbyPlayers] = useState<Array<{
    user_id: string;
    name: string;
    roleLabel: string;
  }>>([]);
  /** Host-authoritative per-participant permission map (keyed by user_id). */
  const [permissions, setPermissions] = useState<PermissionsMap>({});
  /** Draft edits inside the permissions panel — only committed + broadcast when
   *  the host explicitly clicks "Save Changes". */
  const [draftPermissions, setDraftPermissions] = useState<PermissionsMap>({});
  /** Confirmation gate for the destructive "Close Room" action. */
  const [closeRoomConfirmOpen, setCloseRoomConfirmOpen] = useState(false);
  /**
   * When entering Prompt Mode (via Cmd+Enter or double-click in rundown),
   * scroll the prompt canvas so this block's heading + offset is aligned
   * to the eyeline. Consumed once on the next prompt-mode render.
   */
  const pendingPromptJumpRef = useRef<{ blockId: string; offset: number } | null>(null);
  /** Direct pixel scroll target for Edit → Prompt handoff (bypasses block-
   *  based math when we can just carry `containerRef.scrollTop` over). */
  const pendingPromptScrollRef = useRef<number | null>(null);
  /**
   * Reverse handoff: Prompt Mode → Edit Mode. Captures the block under the
   * eyeline (plus a pixel offset down from its heading) so Edit Mode lands
   * at the same vertical location on its next paint.
   */
  const pendingEditJumpRef = useRef<{ blockId: string; offset: number } | null>(null);
  /** Block the operator was reading at the eyeline when they left Prompt
   *  Mode — used to drop the caret in the right editor on return. */
  const lastPromptAnchorBlockIdRef = useRef<string | null>(null);
  /** Latest snap-to-cursor payload broadcast from host. */
  const snapRef = useRef<{ blockId: string; nodeId: string | null; offset: number } | null>(null);
  const [forceShowKey, setForceShowKey] = useState(0);
  /** LOCAL-ONLY edit-mode overview zoom. NEVER broadcast to clients. */
  /** Edit View Toggle — binary. When on (and ONLY in Edit Mode) the editor
   *  text renders at 30% of the user font size so more script fits on screen.
   *  No transform: scale anywhere, so hitboxes stay exact. */
  const [isEditZoomed, setIsEditZoomed] = useState(false);
  /** Play Along Room view magnification. This is deliberately local React
   *  state: it never enters settings, Yjs awareness, or a room broadcast. */
  const [playViewZoom, setPlayViewZoom] = useState(1);
  /** Live pinch-gesture bookkeeping for the local (slave/mobile) canvas. */
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);
  // Local, visual-only zoom for Edit Mode. Purely a CSS scale on the canvas
  // wrapper — does NOT touch TipTap font-size nodes, does NOT sync to peers,
  // and is completely ignored in Prompt Mode so the WYSIWYG output stays
  // locked to the master prompter settings.
  /** Prompter settings popover — controlled so the native macOS menu
   *  (Preferences, Cmd+,) can open it. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Native browser Text-to-Speech (Web Speech API) for reading the script
   *  out loud during rehearsal. Local-only — never broadcast to peers. */
  const {
    supported: ttsSupported,
    speaking: ttsSpeaking,
    speak: ttsSpeak,
    cancel: ttsCancel,
  } = useSpeechSynthesis();
  /** Bumped when the parent requests a scroll-to-block in Edit mode. */
  const [editScrollSignal, setEditScrollSignal] = useState(0);
  /** When true (driven by the Rundown's Backup Mode), the main canvas
   *  contentEditable surface is locked so all edits go through the rundown. */
  const [backupModeLocked, setBackupModeLocked] = useState(false);
  /** Find & Replace (edit mode only). Cmd/Ctrl+F to open; Cmd/Ctrl+G next. */
  const [findOpen, setFindOpen] = useState(false);
  const [stageTimerOpen, setStageTimerOpen] = useState(false);
  const [landerActive, setLanderActive] = useState(false);
  // Phase 2 Yjs multiplayer: a shared doc + Supabase-backed provider live for
  // the duration of a session (pin). Solo editing (no pin) stays non-collab.
  const [collab, setCollab] = useState<{
    doc: YDoc;
    provider: SupabaseYjsProvider;
    user: { name: string; color: string; role?: string };
  } | null>(null);
  const [findQuery, setFindQuery] = useState("");
  const [findReplace, setFindReplace] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [findStatus, setFindStatus] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });
  const findInputRef = useRef<HTMLInputElement>(null);
  /** Hidden picker for script / .prompt imports. */
  const scriptImportInputRef = useRef<HTMLInputElement>(null);

  // Hydrate
  useEffect(() => {
    try {
      // Blank slate: per user request, the rundown is NEVER restored from
      // localStorage. Every machine boots empty unless it joins an existing
      // host session by PIN (in which case the host broadcasts blocks).
      // Clear any legacy persisted script so old data cannot resurface.
      localStorage.removeItem(STORAGE_BLOCKS);
      localStorage.removeItem("tp.blocks.v2");
      localStorage.removeItem(STORAGE_ACTIVE);
      const s = localStorage.getItem(STORAGE_SETTINGS);
      if (s) {
        const parsed = JSON.parse(s) as Partial<PrompterSettings>;
        // Font size is device-scoped: a phone must never inherit the
        // desktop's 96pt face on a fresh load.
        const savedForDevice = Number(localStorage.getItem(fontSizeStorageKey()));
        const fontSize =
          Number.isFinite(savedForDevice) && savedForDevice > 0
            ? savedForDevice
            : initialFontSize();
        setSettings({ ...defaultSettings, ...parsed, fontSize });
        setFontSizeInput(String(fontSize));
      }
      // PIN is also intentionally NOT restored — sessions must be created or
      // joined explicitly so a fresh browser is never auto-attached to an
      // old room.
      localStorage.removeItem(STORAGE_PIN);
    } catch {
      /* ignore malformed persisted settings */
    }
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mobile boot kick. On phones the first paint lands before the scale
  // wrapper / TipTap view has measured itself, which leaves the canvas with a
  // stale hit-test box — touches are swallowed until the user rotates or
  // reloads. Re-broadcasting a resize once we're mounted reproduces exactly
  // what the manual resize did, without any user action.
  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    let raf2 = 0;
    const kick = () => window.dispatchEvent(new Event("resize"));
    const raf1 = requestAnimationFrame(() => {
      kick();
      raf2 = requestAnimationFrame(kick);
    });
    const t = setTimeout(kick, 250);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(t);
    };
  }, [mounted]);

  // Persist pin
  useEffect(() => {
    if (!mounted || displayOnly) return;
    if (pin) localStorage.setItem(STORAGE_PIN, pin);
    else localStorage.removeItem(STORAGE_PIN);
  }, [pin, mounted, displayOnly]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    scrollInertiaRef.current = settings.scrollInertia;
  }, [settings.scrollInertia]);
  // Live-mirror the FULL settings object into a ref so keydown listeners,
  // wheel handlers and the RAF loop always read the current Friction / Max
  // Speed / Encoder Ramp values without waiting for React to reattach them.
  // Fixes the "sliders don't affect the running engine" closure bug.
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  // ------------------------------------------------------------------
  // Same-machine display sync (BroadcastChannel).
  //   Master:  the operator window (any non-`displayOnly` mount).
  //   Slave:   the `/display` extended window (`displayOnly` mount).
  // The channel is shared by every window on the same origin, so opening
  // /display in a second monitor auto-couples. We keep Realtime as the
  // cross-machine fallback — this is a zero-latency same-origin fast path.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("promptinc_display_sync");
    displaySyncChannelRef.current = ch;
    if (displayOnly) {
      // Slave: obey the master's normalized scroll percentage.
      const onMsg = (ev: MessageEvent) => {
        const msg = ev.data;
        if (!msg || msg.type !== "SCROLL_UPDATE") return;
        const text = textRef.current;
        const container = containerRef.current;
        if (!text || !container) return;
        const max = Math.max(0, text.scrollHeight - container.clientHeight);
        const pct = Math.max(0, Math.min(1, Number(msg.percentage) || 0));
        const target = pct * max;
        scrollYRef.current = target;
        // The RAF loop writes the transform on next frame; also mirror to
        // scrollY state so any React-driven consumers stay in step.
        setScrollY(target);
      };
      ch.addEventListener("message", onMsg);
      return () => {
        ch.removeEventListener("message", onMsg);
        ch.close();
        displaySyncChannelRef.current = null;
      };
    }
    return () => {
      ch.close();
      displaySyncChannelRef.current = null;
    };
  }, [displayOnly]);
  useEffect(() => {
    modeRef.current = mode;
    // Sync scroll position when switching between transform-based prompt
    // mode and native-scroll edit mode so we don't jump to the top.
    const el = containerRef.current;
    if (!el) return;
    if (mode === "edit") {
      requestAnimationFrame(() => {
        if (containerRef.current) containerRef.current.scrollTop = scrollYRef.current;
      });
    } else {
      // Prompt Mode must always mount stationary. Any velocity left over from
      // the encoder/keyboard can otherwise push the freshly restored anchor
      // straight into the lead-out before its first painted frame.
      speedRef.current = 0;
      currentSpeedRef.current = 0;
      smoothedTargetRef.current = 0;
      keysRef.current.left = false;
      keysRef.current.right = false;
      setSpeed(0);
      setScrollY(scrollYRef.current);
    }
  }, [mode]);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);
  useEffect(() => {
    blankRef.current = blank;
  }, [blank]);
  useEffect(() => {
    tieDyeRef.current = tieDye;
  }, [tieDye]);

  // Intentionally NOT persisting blocks or activeId — blank slate per machine.
  useEffect(() => {
    if (!mounted || displayOnly) return;
    localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
    localStorage.setItem(fontSizeStorageKey(), String(settings.fontSize));
  }, [settings, mounted, displayOnly]);

  const activeBlock = useMemo(
    () => blocks.find((b) => b.id === activeId) ?? blocks[0],
    [blocks, activeId],
  );

  const promptBlocks = useMemo(
    () =>
      blocks
        .filter((b) => !b.ghosted && b.visibility !== "ghosted" && b.visibility !== "hidden")
        .map((b) => ({ ...b, body: ensurePromptNodeIds(b.body ?? "", b.id) })),
    [blocks, forceShowKey],
  );

  /** Edit-mode renders every block EXCEPT hidden ones — ghosted blocks stay
   *  visible (grayed) and editable so the operator can revive or tweak them.
   *  Same data-prompt-node-id stamps as Prompt mode for caret parity. */
  const editBlocks = useMemo(
    () =>
      blocks
        .filter((b) => b.visibility !== "hidden")
        .map((b) => ({ ...b, body: ensurePromptNodeIds(b.body ?? "", b.id) })),
    [blocks, forceShowKey],
  );

  /** Tap/click anywhere in the empty space below the script → put the caret at
   *  the end of the last block so mobile keyboards open reliably. */
  const focusLastEditor = useCallback(() => {
    const last = editBlocks[editBlocks.length - 1];
    if (!last) return;
    const ed = tiptapEditorsRef.current.get(last.id);
    if (ed && ed.isEditable && !ed.isFocused) ed.commands.focus("end");
  }, [editBlocks]);



  // Sync
  const getState = useCallback<() => PrompterState>(
    () => ({
      playing: speedRef.current !== 0,
      speed: speedRef.current,
      scrollY: scrollYRef.current,
      blank: blankRef.current,
      activeBookmark: null,
      tieDyeActive: tieDyeRef.current,
      hostMode: modeRef.current,
      snapNodeId: snapRef.current?.nodeId ?? null,
      snapBlockId: snapRef.current?.blockId ?? null,
      snapOffset: snapRef.current?.offset ?? 0,
      ts: Date.now(),
    }),
    [],
  );
  const presenceSelf = useMemo<Omit<PresenceMeta, "editing_block_id"> | null>(() => {
    if (displayOnly || !user) return null;
    return {
      user_id: user.id,
      name: user.name,
      avatar_url: user.avatar_url,
      color: colorForUserId(user.id),
      role,
    };
  }, [displayOnly, user, role]);
  const {
    remoteState,
    remoteBlocks,
    remoteDisplay,
    connected,
    lastReceivedAt,
    broadcastNow,
    broadcastBlocks,
    broadcastDisplay,
    broadcastInitialSync,
    broadcastPermissions,
    remotePermissions,
    broadcastRoomClosed,
    roomClosed,
    broadcastKickUser,
    kicked,
    peers,
    retryConnection,
    setEditingBlock,
    sendProposeChange,
    sendAck,
    onProposeChange,
    onAck,
    broadcastAnnotations,
    remoteAnnotations,
  } = useTeleprompterSync(role, getState, pin, presenceSelf);

  // ---- Annotation persistence + room sync ----
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const remoteAnnotationTsRef = useRef(0);
  const skipAnnotationBroadcastRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ANNOTATIONS, JSON.stringify(annotations));
    } catch {
      /* storage full / private mode — annotations still live in memory */
    }
    if (skipAnnotationBroadcastRef.current) {
      skipAnnotationBroadcastRef.current = false;
      return;
    }
    if (!pin) return;
    broadcastAnnotations(annotations);
  }, [annotations, pin, broadcastAnnotations]);

  useEffect(() => {
    if (!remoteAnnotations) return;
    if (remoteAnnotations.ts <= remoteAnnotationTsRef.current) return;
    remoteAnnotationTsRef.current = remoteAnnotations.ts;
    skipAnnotationBroadcastRef.current = true;
    setAnnotations((remoteAnnotations.annotations as Annotation[]) ?? []);
  }, [remoteAnnotations]);

  const addAnnotation = useCallback((a: Annotation) => {
    setAnnotations((prev) => [...prev, a]);
  }, []);
  const updateAnnotation = useCallback((id: string, patch: Partial<Annotation>) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);
  const removeAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);
  const clearAnnotations = useCallback(() => setAnnotations([]), []);

  /** Measure every block's unscaled offset inside the master canvas so
   *  annotations stay pinned to their block through scrolling, mode switches
   *  and re-flows. */
  const measureBlockOffsets = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = totalScaleRef.current || 1;
    const base = canvas.getBoundingClientRect().top;
    const next = new Map<string, BlockOffset>();
    canvas.querySelectorAll<HTMLElement>("[data-block-id]").forEach((el) => {
      const id = el.dataset.blockId;
      if (!id) return;
      const r = el.getBoundingClientRect();
      next.set(id, { top: (r.top - base) / s, height: r.height / s });
    });
    setBlockOffsets((prev) => {
      if (prev.size === next.size) {
        let same = true;
        for (const [id, off] of next) {
          const old = prev.get(id);
          if (!old || Math.abs(old.top - off.top) > 0.5 || Math.abs(old.height - off.height) > 0.5) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    measureBlockOffsets();
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureBlockOffsets());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [measureBlockOffsets, mode, blocks, canvasNaturalHeight]);

  // ---- Bouncer & Lobby handshake ----
  const lobbyRoomId = sessionId ?? pin;
  const {
    requests: joinRequests,
    status: lobbyStatus,
    denyReason: lobbyDenyReason,
    requestJoin,
    admit: lobbyAdmit,
    deny: lobbyDeny,
  } = useSessionLobby({
    sessionId: lobbyRoomId,
    isHost: role === "host",
    active: role === "host" ? !!pin : isLobbyArrival && !admitted,
    selfId: user?.id ?? null,
  });

  // Auto-deny lobby requests whose PIN does not match the host's code.
  useEffect(() => {
    if (role !== "host" || !sessionPin) return;
    for (const r of joinRequests) {
      if (r.pin !== sessionPin) lobbyDeny(r.clientId, "Incorrect PIN");
    }
  }, [role, sessionPin, joinRequests, lobbyDeny]);

  // When the host admits us, connect to the live document.
  useEffect(() => {
    if (lobbyStatus === "admitted" && sessionId && !pin) {
      setPin(sessionId);
      setAdmitted(true);
    }
  }, [lobbyStatus, sessionId, pin]);

  // Host: when a request matches the PIN, surface it as a banner alert.
  const pendingAdmissions = useMemo(
    () => (sessionPin ? joinRequests.filter((r) => r.pin === sessionPin) : []),
    [joinRequests, sessionPin],
  );

  const handleAdmit = useCallback(
    (req: { clientId: string; name?: string; role?: string }) => {
      setPermissions((prev) =>
        prev[req.clientId]
          ? prev
          : { ...prev, [req.clientId]: { ...DEFAULT_OBSERVE_PERMISSIONS } },
      );
      setDraftPermissions((prev) =>
        prev[req.clientId]
          ? prev
          : { ...prev, [req.clientId]: { ...DEFAULT_OBSERVE_PERMISSIONS } },
      );
      setAdmittedLobbyPlayers((prev) =>
        prev.some((player) => player.user_id === req.clientId)
          ? prev
          : [
              ...prev,
              {
                user_id: req.clientId,
                name: req.name || "Player",
                roleLabel: req.role || "Player",
              },
            ],
      );
      lobbyAdmit(req.clientId);
      setParticipantsOpen(true);
    },
    [lobbyAdmit],
  );

  // Client-side ack registry: a Map keyed by change_id of one-shot callbacks.
  const ackListenersRef = useRef<Map<string, () => void>>(new Map());
  useEffect(() => {
    onAck((p: AckPayload) => {
      const cb = ackListenersRef.current.get(p.change_id);
      if (cb) {
        ackListenersRef.current.delete(p.change_id);
        cb();
      }
    });
    return () => onAck(null);
  }, [onAck]);
  const registerAckListener = useCallback((changeId: string, cb: () => void) => {
    ackListenersRef.current.set(changeId, cb);
    return () => {
      ackListenersRef.current.delete(changeId);
    };
  }, []);

  // Host: receive propose_change → apply locally → broadcast ACK.
  useEffect(() => {
    if (role !== "host" || displayOnly) return;
    onProposeChange((p: ProposeChangePayload) => {
      const blockTitle = blocks.find((b) => b.id === p.block_id)?.title ?? "block";
      setBlocks(blocks.map((b) => (b.id === p.block_id ? { ...b, body: p.html } : b)));
      toast.success(`${p.from_user.name} pushed an edit to ${blockTitle}`);
      sendAck({
        change_id: p.change_id,
        by: { id: user?.id ?? "host", name: user?.name ?? "Host" },
      });
    });
    return () => onProposeChange(null);
  }, [role, displayOnly, onProposeChange, sendAck, user, blocks, setBlocks]);

  const buildDisplayPayload = useCallback(
    (): DisplayPayload => ({
      mode,
      flipH: settings.flipH,
      flipV: settings.flipV,
      marginH: settings.marginH,
      marginV: settings.marginV,
      align: settings.align,
      allCaps: settings.allCaps,
      fontFamily: settings.fontFamily,
      lineHeight: settings.lineHeight,
      bgColor: settings.bgColor,
      showArrow: settings.showArrow,
      showTimer: settings.showTimer,
      triangleColor: settings.triangleColor,
      triangleSize: settings.triangleSize,
      eyelineY: settings.eyelineY,
      hostViewportW: hostViewport?.width,
      hostViewportH: hostViewport?.height,
      ts: Date.now(),
    }),
    [settings, mode, hostViewport],
  );

  // Host: broadcast block edits — snappy 80ms debounce for live rundown editing.
  useEffect(() => {
    if (!mounted || role !== "host") return;
    const t = setTimeout(() => {
      broadcastBlocks({ blocks, activeId, ts: Date.now() });
    }, 80);
    return () => clearTimeout(t);
  }, [blocks, activeId, role, mounted, broadcastBlocks]);

  // Host: broadcast display settings
  useEffect(() => {
    if (!mounted || role !== "host") return;
    const t = setTimeout(() => broadcastDisplay(buildDisplayPayload()), 80);
    return () => clearTimeout(t);
  }, [settings, hostViewport, role, mounted, broadcastDisplay, buildDisplayPayload]);

  const buildInitialSyncPayload = useCallback(
    (): InitialSyncPayload => ({
      state: getState(),
      blocks: { blocks, activeId, ts: Date.now() } satisfies BlocksPayload,
      display: buildDisplayPayload(),
      ts: Date.now(),
    }),
    [blocks, activeId, buildDisplayPayload, getState],
  );

  // Host: respond to client hello / REQUEST_SYNC by re-emitting a complete snapshot.
  useEffect(() => {
    if (role !== "host") return;
    const sendFullSync = () => {
      broadcastInitialSync(buildInitialSyncPayload());
      broadcastBlocks({ blocks, activeId, ts: Date.now() });
      broadcastDisplay(buildDisplayPayload());
      broadcastNow(getState());
      broadcastPermissions(permissionsRef.current);
    };
    window.addEventListener("tp:hello", sendFullSync);
    window.addEventListener("tp:request-sync", sendFullSync);
    return () => {
      window.removeEventListener("tp:hello", sendFullSync);
      window.removeEventListener("tp:request-sync", sendFullSync);
    };
  }, [
    role,
    blocks,
    activeId,
    broadcastBlocks,
    broadcastDisplay,
    broadcastNow,
    broadcastInitialSync,
    buildDisplayPayload,
    buildInitialSyncPayload,
    getState,
    broadcastPermissions,
  ]);

  // Keep a live ref of host-authored permissions for handshake replays.
  const permissionsRef = useRef<PermissionsMap>(permissions);
  useEffect(() => {
    permissionsRef.current = permissions;
  }, [permissions]);

  // When the permissions panel opens, seed the draft from the live committed
  // permissions so edits start from the current broadcast state.
  useEffect(() => {
    if (participantsOpen) setDraftPermissions({ ...permissionsRef.current });
  }, [participantsOpen]);

  // Host: seed a default (observe-only) permission entry for every newly seen
  // non-host participant so the console always lists them.
  useEffect(() => {
    if (role !== "host") return;
    setPermissions((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const p of peers) {
        if (p.role === "host" || p.user_id === user?.id) continue;
        if (!next[p.user_id]) {
          next[p.user_id] = { ...DEFAULT_OBSERVE_PERMISSIONS };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [peers, role, user?.id]);

  // Host: broadcast the permission map whenever it changes.
  useEffect(() => {
    if (role !== "host") return;
    broadcastPermissions(permissions);
  }, [permissions, role, broadcastPermissions]);

  // Resolve the permissions that apply to THIS user (host has full control).
  const selfPermissions: ParticipantPermissions = useMemo(() => {
    if (role === "host") return HOST_PERMISSIONS;
    if (!user) return DEFAULT_OBSERVE_PERMISSIONS;
    return remotePermissions[user.id] ?? DEFAULT_OBSERVE_PERMISSIONS;
  }, [role, user, remotePermissions]);

  // Edit Mode editing is allowed for the host always, or for a follower whose
  // host granted "Allow Edits in Edit Mode".
  const editModeAllowed = role === "host" || selfPermissions.editInEditMode;

  // Mirror the resolved permissions into a ref so wheel/touch/key listeners can
  // consult them without re-subscribing (no churn on the Yjs/editor hot path).
  useEffect(() => {
    selfPermissionsRef.current = selfPermissions;
  }, [selfPermissions]);

  // Retro "VIEW ONLY" feedback for a read-only follower who tries to drive the
  // prompter or type. Throttled to once every 2.5s to avoid a toast storm.
  const notifyLocked = useCallback(() => {
    const now = Date.now();
    if (now - lastLockToastRef.current < 2500) return;
    lastLockToastRef.current = now;
    toast("VIEW ONLY: WAITING FOR HOST PERMISSIONS", {
      position: "bottom-center",
      duration: 2200,
      style: {
        background: "#000000",
        color: "#ffffff",
        border: "2px solid #0055FF",
        borderRadius: "0px",
        fontFamily:
          "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: "12px",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        boxShadow: "0 0 0 1px #000, 0 6px 24px rgba(226,24,54,0.35)",
      },
    });
  }, []);

  // Client: receive blocks
  useEffect(() => {
    if (role !== "client" || !remoteBlocks) return;
    setBlocks(remoteBlocks.blocks);
    if (remoteBlocks.activeId) setActiveId(remoteBlocks.activeId);
  }, [remoteBlocks, role, displayOnly]);

  // Load the "don't show prompt-mode warning again" preference once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    promptDangerSuppressedRef.current =
      localStorage.getItem("tp_prompt_danger_suppressed") === "1";
  }, []);

  // Host 'Kill Switch': when the host closes the room, kick this client to the
  // terminated fallback screen and tear down the realtime connection.
  useEffect(() => {
    if (role !== "client" || !roomClosed) return;
    setRoomTerminated(true);
    speedRef.current = 0;
    setSpeed(0);
    setPin(null);
  }, [roomClosed, role]);

  // Targeted 'Kick': when the host ejects THIS specific client, instantly tear
  // down the realtime/Yjs connection and show the removal fallback screen.
  useEffect(() => {
    if (role !== "client" || !kicked) return;
    setTerminatedByKick(true);
    setRoomTerminated(true);
    speedRef.current = 0;
    setSpeed(0);
    setPin(null);
  }, [kicked, role]);

  // Host action: archive the room & disconnect every REMOTE participant while
  // keeping the host's own master control session fully intact. We broadcast a
  // `room_closed` signal (which only the clients act on) — the host never tears
  // down its own channel, document state, or editor view.
  const handleCloseRoom = useCallback(() => {
    broadcastRoomClosed();
    toast.success("Play Along Room archived — remote players disconnected", {
      description: "You're still connected to your master control workspace.",
    });
    setParticipantsOpen(false);
    // Clear any seeded remote-participant permissions; the host stays hosting.
    setPermissions({});
  }, [broadcastRoomClosed]);

  // Locally-suppressed participant ids — removed from the roster the instant the
  // host kicks them, before presence catches up with their disconnect.
  const [kickedUserIds, setKickedUserIds] = useState<string[]>([]);
  /** Two-step kick confirmation: holds the user id whose 'X' is armed. */
  const [kickConfirmId, setKickConfirmId] = useState<string | null>(null);

  // Host action: surgically eject ONE participant. Broadcasts a targeted
  // `kick_user` event (carrying the participant's user id), drops their seeded
  // permissions, and removes them from the roster immediately — without
  // touching the room/session state or any other participant.
  const handleKickUser = useCallback(
    (userId: string, name: string) => {
      broadcastKickUser(userId);
      setKickedUserIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
      setPermissions((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      setDraftPermissions((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      toast.success(`Removed ${name} from the room`);
    },
    [broadcastKickUser],
  );

  /** Crew dropdown (top bar) open state. */
  const [crewMenuOpen, setCrewMenuOpen] = useState(false);
  /** Participant currently holding scroll control (host = null). */
  const [scrollDriverId, setScrollDriverId] = useState<string | null>(null);

  /** Instantly flip a participant between Viewer and Editor. Commits straight
   *  to the live permissions map, which auto-broadcasts to the room. */
  const setCrewRole = useCallback(
    (userId: string, next: "viewer" | "editor") => {
      const apply = (prev: PermissionsMap): PermissionsMap => ({
        ...prev,
        [userId]:
          next === "editor"
            ? {
                observeOnly: false,
                editWhilePrompting: true,
                editInEditMode: true,
                scrollControl: prev[userId]?.scrollControl ?? false,
              }
            : { ...DEFAULT_OBSERVE_PERMISSIONS },
      });
      setPermissions(apply);
      setDraftPermissions(apply);
    },
    [],
  );

  /** Hand the scroll wheel to one participant: they gain scrollControl, every
   *  other participant loses it, and the host stops driving (speed → 0). */
  const passScrollControl = useCallback(
    (userId: string | null, name?: string) => {
      const apply = (prev: PermissionsMap): PermissionsMap => {
        const next: PermissionsMap = {};
        for (const [uid, perm] of Object.entries(prev)) {
          next[uid] = { ...perm, scrollControl: uid === userId };
        }
        if (userId && !next[userId]) {
          next[userId] = { ...DEFAULT_OBSERVE_PERMISSIONS, scrollControl: true };
        }
        return next;
      };
      setPermissions(apply);
      setDraftPermissions(apply);
      setScrollDriverId(userId);
      setSpeed(0);
      if (userId) toast.success(`Scroll control passed to ${name ?? "player"}`);
      else toast.success("Scroll control returned to you");
    },
    [],
  );

  // Remote-editor guard: returns true when the keystroke should be intercepted
  // (a warning modal is shown). Host and solo editing never gate.
  const guardRemoteEdit = useCallback(() => {
    if (role === "host" || !collab) return false;
    // Highest priority: host is live in prompt mode.
    if (hostModeRef.current === "prompt" && !promptDangerSuppressedRef.current) {
      setPromptDangerOpen(true);
      return true;
    }
    // First-ever edit acknowledgement.
    if (!hasAckFirstEditRef.current) {
      setFirstEditWarnOpen(true);
      return true;
    }
    return false;
  }, [role, collab]);

  // Client: receive state (incl. blank)
  useEffect(() => {
    if (role !== "client" || !remoteState) return;
    // SCROLL DECOUPLING — a remote editor who has dropped into Edit Mode must
    // ignore every incoming SCROLL_UPDATE from the host so they can type
    // "underneath" without the caret being ripped away. Yjs keeps the text in
    // sync; only the viewport is detached.
    if (mode === "edit" && editModeAllowed) return;
    speedRef.current = remoteState.speed;
    setSpeed(remoteState.speed);
    // Snap-to-cursor: prefer stable paragraph IDs so each display aligns its own DOM node.
    if (remoteState.snapNodeId) {
      const text = textRef.current;
      const node = textRef.current?.querySelector<HTMLElement>(
        `[data-prompt-node-id="${cssEscape(remoteState.snapNodeId)}"]`,
      );
      if (text && node) {
        const baseTop = text.getBoundingClientRect().top + scrollYRef.current;
        const nodeY = node.getBoundingClientRect().top + scrollYRef.current - baseTop;
        const eye = (settings.eyelineY || 0.5) * window.innerHeight;
        const target = Math.max(0, nodeY - eye + node.getBoundingClientRect().height / 2);
        speedRef.current = 0;
        setSpeed(0);
        node.scrollIntoView({ block: "center", inline: "nearest" });
        scrollYRef.current = target;
        setScrollY(target);
      } else if (remoteState.snapBlockId) {
        const text = textRef.current;
        const containerH = containerRef.current?.clientHeight ?? 0;
        const max = text ? Math.max(0, text.scrollHeight - containerH) : remoteState.scrollY;
        const clamped = Math.max(0, Math.min(max, remoteState.scrollY));
        scrollYRef.current = clamped;
        setScrollY(clamped);
      }
    } else if (remoteState.snapBlockId) {
      const text = textRef.current;
      const node = text?.querySelector<HTMLElement>(
        `[data-block-heading="${remoteState.snapBlockId}"]`,
      );
      if (text && node) {
        const baseTop = text.getBoundingClientRect().top + scrollYRef.current;
        const headingY = node.getBoundingClientRect().top + scrollYRef.current - baseTop;
        const eye = (settings.eyelineY || 0.5) * window.innerHeight;
        const target = Math.max(0, headingY + (remoteState.snapOffset ?? 0) - eye);
        scrollYRef.current = target;
        setScrollY(target);
      } else {
        const containerH = containerRef.current?.clientHeight ?? 0;
        const max = text ? Math.max(0, text.scrollHeight - containerH) : remoteState.scrollY;
        const clamped = Math.max(0, Math.min(max, remoteState.scrollY));
        scrollYRef.current = clamped;
        setScrollY(clamped);
      }
    } else {
      const text = textRef.current;
      const containerH = containerRef.current?.clientHeight ?? 0;
      const max = text ? Math.max(0, text.scrollHeight - containerH) : remoteState.scrollY;
      const clamped = Math.max(0, Math.min(max, remoteState.scrollY));
      scrollYRef.current = clamped;
      setScrollY(clamped);
    }
    setBlank(!!remoteState.blank);
    setTieDye(!!remoteState.tieDyeActive);
    if (remoteState.hostMode) hostModeRef.current = remoteState.hostMode;
  }, [remoteState, role, settings.eyelineY, mode, editModeAllowed]);

  // Client: receive display settings
  useEffect(() => {
    if (role !== "client" || !remoteDisplay) return;
    const { mode: remoteMode, ...displaySettings } = remoteDisplay;
    // Never yank a decoupled remote editor out of Edit Mode.
    if (remoteMode && !(mode === "edit" && editModeAllowed)) setMode(remoteMode);
    setSettings((s) => ({ ...s, ...displaySettings }));
  }, [remoteDisplay, role, mode, editModeAllowed]);

  // Client failover watchdog: pause + flag if host packets stop arriving.
  useEffect(() => {
    if (role !== "client" || !pin) {
      setHostLost(false);
      return;
    }
    const id = setInterval(() => {
      if (lastReceivedAt === 0) return; // never received yet — not "lost"
      const stale = Date.now() - lastReceivedAt > 1500;
      if (stale && !hostLost) {
        speedRef.current = 0;
        setSpeed(0);
        setHostLost(true);
      } else if (!stale && hostLost) {
        setHostLost(false);
      }
    }, 250);
    return () => clearInterval(id);
  }, [role, pin, lastReceivedAt, hostLost]);

  // ---- Session helpers ----
  const handleCreateSession = () => {
    if (!authUser) {
      toast.info("Sign in to host a Play Along Room.");
      setSignInOpen(true);
      return;
    }
    const newPin = generatePin();
    setPin(newPin);
    setSessionId(newPin);
    setSessionPin(generateNumericPin());
    setRole("host");
    setHostLost(false);
    setParticipantsOpen(true);
  };
  const handleJoinSession = () => {
    const p = normalizePin(joinInput);
    if (p.length !== 6) return;
    setPin(p);
    setRole("client");
    setJoinInput("");
    setHostLost(false);
  };
  const handleLeaveSession = () => {
    // SAFE DISCONNECT — sever the network only. We never unmount the editors,
    // never clear content, never reload or route-push. Dropping `pin` tears
    // down the realtime channel + (deferred) Yjs provider, and flipping the
    // role back to `host` puts this machine into Solo Mode with the script
    // exactly as it stands on screen.
    setPin(null);
    setRole("host");
    setHostLost(false);
    setAdmitted(true);
    setParticipantsOpen(false);
    setSessionModalOpen(false);
    setConnectionMenuOpen(false);
    speedRef.current = 0;
    setSpeed(0);
    toast.success("Disconnected — back in solo mode", {
      description: "Your script stayed exactly where it was.",
    });
  };
  /**
   * One-click test room: generate a fresh PIN, become host, and copy a
   * ready-to-share producer link to the clipboard so a second session can
   * join instantly for collaboration testing.
   */
  const handleCreateTestRoom = async () => {
    if (!authUser) {
      toast.info("Sign in to host a Play Along Room.");
      setSignInOpen(true);
      return;
    }
    const newPin = generatePin();
    const code = generateNumericPin();
    setPin(newPin);
    setSessionId(newPin);
    setSessionPin(code);
    setRole("host");
    setHostLost(false);
    setParticipantsOpen(true);
    const link = `${window.location.origin}/play/${encodeURIComponent(newPin)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Play Along Room ready — link copied", {
        description: `Entry PIN ${code} · ${link}`,
      });
    } catch {
      toast.success(`Test room ready — Entry PIN ${code}`, { description: link });
    }
  };
  const takeOverAsHost = () => {
    setSessionId((prev) => prev ?? pin);
    setSessionPin((prev) => prev ?? generateNumericPin());
    setRole("host");
    setHostLost(false);
    speedRef.current = 0;
    setSpeed(0);
  };
  /**
   * "New Show" hard reset. Wipes the TipTap canvas, clears every rundown
   * block back to a single empty block, and broadcasts the cleared state so
   * connected Producer / Display windows are reset instantly.
   */
  /**
   * Read the whole script aloud with the browser's native speech engine.
   * Skips hidden/ghosted blocks so the reader matches what actually goes to air.
   */
  const readScriptAloud = () => {
    if (!ttsSupported) {
      toast.error("Text-to-speech is not available in this browser");
      return;
    }
    const text = blocks
      .filter((b) => !b.ghosted && b.visibility !== "ghosted" && b.visibility !== "hidden")
      .map((b) => {
        const html = b.body || "";
        if (typeof document === "undefined") return html;
        const el = document.createElement("div");
        el.innerHTML = html;
        return el.textContent || "";
      })
      .join("\n")
      .trim();
    if (!text) {
      toast.error("Nothing to read — the script is empty");
      return;
    }
    if (ttsSpeak(text, 0.95)) toast.success("Reading script aloud…");
  };
  /**
   * Total state reset. Wipes every cached script artifact (localStorage +
   * the local-first Yjs IndexedDB caches) and returns all layout / scroll /
   * UI toggles to their default constants, so a refresh or a brand-new
   * browser window boots completely empty.
   */
  const purgeAppState = useCallback(() => {
    try {
      for (const key of [
        STORAGE_BLOCKS,
        "tp.blocks.v2",
        STORAGE_ACTIVE,
        STORAGE_ANNOTATIONS,
        STORAGE_PIN,
        STORAGE_SETTINGS,
      ]) {
        localStorage.removeItem(key);
      }
      // Any other per-script cache keys written by older builds.
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("tp.blocks") || k.startsWith("tp.active") || k.startsWith("tp.annotations"))) {
          localStorage.removeItem(k);
        }
      }
    } catch {
      /* storage unavailable — nothing to purge */
    }
    // Local-first Yjs document caches (`promptinc-<pin>`).
    try {
      const idb = indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> };
      void idb.databases?.().then((dbs) => {
        for (const db of dbs) {
          if (db.name && db.name.startsWith("promptinc-")) indexedDB.deleteDatabase(db.name);
        }
      }).catch(() => { /* ignore */ });
    } catch {
      /* IndexedDB unavailable */
    }
    // Reset in-memory UI state back to the shipped defaults.
    setSettings(defaultSettings);
    setAnnotations([]);
    setIsEditZoomed(false);
    setRollerValue(0);
    speedRef.current = 0;
    setSpeed(0);
    setScrollY(0);
  }, []);

  const handleNewShow = () => {
    // TTS safety: never let the reader keep talking through a hard reset.
    ttsCancel();
    // A. Instantly wipe each live TipTap editor and force the caret back into
    //    one of them so the operator can start typing immediately.
    let focused = false;
    for (const ed of tiptapEditorsRef.current.values()) {
      try {
        ed.chain().clearContent(true).focus().run();
        focused = true;
      } catch {
        /* editor may be tearing down */
      }
    }
    void focused;
    tiptapEditorsRef.current.clear();
    // B. Reset rundown state to a single fresh empty block.
    const freshId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fresh: ScriptBlock[] = [{ id: freshId, title: "Block 1", body: "<p></p>" }];
    setBlocks(fresh);
    setActiveId(freshId);
    setSpeed(0);
    speedRef.current = 0;
    setScrollY(0);
    // B2. Total state purge — settings, annotations, zoom and every cached
    //     script key, so a fresh browser window never resurrects ghosts.
    purgeAppState();
    // C. Broadcast the wipe so producers / displays clear immediately.
    if (role === "host") {
      broadcastBlocks({ blocks: fresh, activeId: freshId, ts: Date.now() });
    }
    setNewShowOpen(false);
    toast.success("New show — script cleared");
  };
  /** "Save" branch of the New Show safety flow — write the script to disk,
   *  and only reset once the save actually succeeds. */
  const handleSaveThenNewShow = async () => {
    try {
      await exportPromptinc("show", blocks);
    } catch {
      toast.error("Save cancelled — your script was not cleared");
      return;
    }
    handleNewShow();
  };
  const copyPin = async () => {
    if (!pin) return;
    try {
      await navigator.clipboard.writeText(pin);
      setPinCopied(true);
      setTimeout(() => setPinCopied(false), 1200);
    } catch {
      /* clipboard unavailable — silent no-op */
    }
  };

  // RAF loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // Delta-time. Everything below is expressed per 1/60s "frame unit" so a
      // dropped frame (or a 120Hz display) travels the same distance per
      // second instead of speeding up / stalling with the refresh rate.
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const frames = dt * 60;
      if (roleRef.current === "host") {
        // Keep the React speed state roughly in sync for HUD readouts. The
        // ref is the source of truth and is updated synchronously by the
        // keydown handler so taps register immediately, with no batching lag.
        if (Math.abs(speedRef.current - speed) > 0.5) setSpeed(Math.round(speedRef.current));
      }
      // Momentum / inertia: `speedRef` is the *target* velocity (updated
      // instantly by keyboard, encoder, or remote sync). `currentSpeedRef`
      // is the velocity we actually apply this frame, and it LERPs toward
      // the target so a sudden reversal from the encoder decelerates and
      // re-accelerates smoothly instead of snapping.
      //
      //   currentSpeed += (targetSpeed - currentSpeed) * friction
      //
      // `friction` (a.k.a. scrollInertia) of 1.0 = instant, 0.05 = sluggish.
      // Both easing constants are converted to a delta-time exponential so
      // the feel is identical at 30, 60 or 120fps.
      const target = speedRef.current;
      const friction = clampNum(scrollInertiaRef.current, 0.01, 1);
      // Two-stage easing. Stage 1 dampens the *target* itself so a hard
      // encoder step doesn't arrive as a cliff; stage 2 is the usual
      // inertia LERP toward that softened target.
      const TARGET_DAMPING = 0.35;
      const dampK = 1 - Math.pow(1 - TARGET_DAMPING, frames);
      const frictionK = 1 - Math.pow(1 - friction, frames);
      smoothedTargetRef.current += (target - smoothedTargetRef.current) * dampK;
      if (target === 0 && Math.abs(smoothedTargetRef.current) < 0.1) {
        smoothedTargetRef.current = 0;
      }
      currentSpeedRef.current +=
        (smoothedTargetRef.current - currentSpeedRef.current) * frictionK;
      // Zero-point snap: kill sub-pixel drift once the user has released
      // the encoder. Without this the LERP produces microscopic residual
      // velocity that would nudge the scroll forever.
      if (target === 0 && Math.abs(currentSpeedRef.current) < 0.1) {
        currentSpeedRef.current = 0;
      }
      // Sub-pixel float distance for this exact frame duration.
      const newScrollPosition = scrollYRef.current + currentSpeedRef.current * frames;
      const text = textRef.current;

      const scrollContainer = containerRef.current;
      if (text && scrollContainer) {
        const minScroll = 0;
        // Deliberately measure this on every frame. Prompt Mode injects real
        // 80vh lead-in/out nodes, so a bound captured before that paint is
        // immediately stale and can trap the engine at the old document end.
        const maxScroll = Math.max(
          minScroll,
          scrollContainer.scrollHeight - scrollContainer.clientHeight,
        );
        if (scrollContainer.scrollTop > maxScroll) {
          scrollContainer.scrollTop = maxScroll;
        }
        // Prompt movement is transform-owned. Clear any native edit-mode
        // scroll retained across the React layout swap so it cannot compound
        // with translateY and create a double-scroll trap.
        if (modeRef.current === "prompt" && scrollContainer.scrollTop !== 0) {
          scrollContainer.scrollTop = 0;
        }
        scrollYRef.current = Math.max(
          minScroll,
          Math.min(newScrollPosition, maxScroll),
        );
        if (
          (scrollYRef.current === minScroll && currentSpeedRef.current < 0) ||
          (scrollYRef.current === maxScroll && currentSpeedRef.current > 0)
        ) {
          speedRef.current = 0;
          currentSpeedRef.current = 0;
          smoothedTargetRef.current = 0;
        }
        // In edit mode we use the container's native overflow scroll, so do
        // NOT write transform — it fights the browser's own scrollTop and
        // can pin the canvas off the very top.
        if (modeRef.current === "edit") {
          if (speedRef.current !== 0) speedRef.current = 0;
          currentSpeedRef.current = 0;
          smoothedTargetRef.current = 0;
          if (lastTransformYRef.current !== null) {
            text.style.transform = "";
            lastTransformYRef.current = null;
          }
        } else {
          // Only touch the DOM when the scroll position actually changed —
          // avoids the browser recomposing every frame while paused.
          const y = scrollYRef.current;
          if (lastTransformYRef.current !== y) {
            text.style.transform = `translate3d(0, ${-y}px, 0)`;
            lastTransformYRef.current = y;
          }
        }
        // Master-window broadcast: emit normalized scroll position for the
        // extended /display window. Percentage (not pixels) so a different
        // monitor height still lands on the same line.
        if (!displayOnly && modeRef.current === "prompt" && displaySyncChannelRef.current) {
          const max = Math.max(1, text.scrollHeight - (containerRef.current?.clientHeight ?? 0));
          const pct = Math.max(0, Math.min(1, scrollYRef.current / max));
          if (Math.abs(pct - lastBroadcastPctRef.current) > 0.00005) {
            lastBroadcastPctRef.current = pct;
            try {
              displaySyncChannelRef.current.postMessage({ type: "SCROLL_UPDATE", percentage: pct });
            } catch {
              /* channel closed between frames — next mount re-opens */
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer tick
  useEffect(() => {
    if (!settings.showTimer) return;
    const id = setInterval(() => setTimerNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [settings.showTimer]);

  // Reset on script change — only in edit mode (prompt mode is continuous flow).
  useEffect(() => {
    // Edit mode is now ALSO a continuous canvas — switching the active block
    // must not snap scroll back to 0. Block-targeted scrolls are handled by
    // the pending-edit-scroll effect below.
    return;
  }, [activeBlock?.id]);

  // Edit mode: scroll the continuous canvas so the requested block heading
  // aligns with the eyeline. Triggered by sidebar click, Cmd+], or
  // onJumpToBlock paths that explicitly want a scroll (not by typing focus).
  useEffect(() => {
    if (mode !== "edit") return;
    const pending = pendingEditScrollRef.current;
    if (!pending) return;
    const { id, offsetRatio = 0 } = pending;
    const raf = requestAnimationFrame(() => {
      const text = textRef.current;
      const node = text?.querySelector<HTMLElement>(`[data-block-heading="${cssEscape(id)}"]`);
      if (text && node) {
        const baseTop = text.getBoundingClientRect().top + scrollYRef.current;
        const headingY = node.getBoundingClientRect().top + scrollYRef.current - baseTop;
        const eye = (settings.eyelineY || 0.5) * window.innerHeight;
        const target = Math.max(0, headingY + node.scrollHeight * offsetRatio - eye);
        speedRef.current = 0;
        setSpeed(0);
        scrollYRef.current = target;
        setScrollY(target);
        if (containerRef.current) containerRef.current.scrollTop = target;
        const snapOffset = node.scrollHeight * offsetRatio;
        snapRef.current = { blockId: id, nodeId: null, offset: snapOffset };
        broadcastNow({
          playing: false,
          speed: 0,
          scrollY: target,
          blank: blankRef.current,
          activeBookmark: null,
          tieDyeActive: tieDyeRef.current,
          snapNodeId: null,
          snapBlockId: id,
          snapOffset,
          ts: Date.now(),
        });
      }
      pendingEditScrollRef.current = null;
    });
    return () => cancelAnimationFrame(raf);
  }, [editScrollSignal, mode, settings.eyelineY, broadcastNow]);

  /** Request that the edit-mode canvas scroll to a specific block. */
  const requestEditScrollTo = useCallback((id: string, offsetRatio?: number) => {
    pendingEditScrollRef.current = { id, offsetRatio };
    setEditScrollSignal((s) => s + 1);
  }, []);

  /** Edit mode: when caret reaches end (dir=1) or start (dir=-1) of a block
   *  editor and user presses Arrow Right / Left, jump caret into the
   *  adjacent block and scroll that block to the eyeline. */
  const navigateAdjacentBlock = useCallback(
    (fromId: string, dir: 1 | -1) => {
      const idx = blocks.findIndex((b) => b.id === fromId);
      if (idx < 0) return false;
      const targetIdx = idx + dir;
      if (targetIdx < 0 || targetIdx >= blocks.length) return false;
      const target = blocks[targetIdx];
      const el = editorsRef.current.get(target.id);
      if (!el) return false;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(dir === 1); // start for next, end for prev
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      syncDomRangeToTiptap(range);
      setActiveId(target.id);
      requestEditScrollTo(target.id);
      return true;
      // syncDomRangeToTiptap is a stable useCallback declared below; omitted from
      // deps to avoid a use-before-declaration during render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [blocks, requestEditScrollTo],
  );

  /** Edit mode: jump caret into the first or last block (Home / End). */
  const jumpEditEdge = useCallback(
    (edge: "first" | "last") => {
      if (blocks.length === 0) return false;
      const target = edge === "first" ? blocks[0] : blocks[blocks.length - 1];
      const el = editorsRef.current.get(target.id);
      if (!el) return false;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(edge === "first"); // start for first, end for last
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      syncDomRangeToTiptap(range);
      setActiveId(target.id);
      requestEditScrollTo(target.id);
      return true;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [blocks, requestEditScrollTo],
  );

  /** BlockEditor focus → mark this block active + remember which editor
   *  receives persists from the toolbar (bold / color / size / bookmark). */
  const handleEditorFocus = useCallback(
    (id: string, el: HTMLDivElement | null) => {
      if (!el) return;
      editorRef.current = el;
      activeEditorBlockIdRef.current = id;
      if (activeId !== id) setActiveId(id);
    },
    [activeId],
  );

  /** BlockEditor input → persist that block's HTML back into state. TipTap
   *  hands us the already-serialized HTML from the ProseMirror document. */
  // Performance: debounce block-state commits so a burst of keystrokes doesn't
  // re-render the entire Teleprompter tree on every character. TipTap owns the
  // live document; block.body is only needed for persistence, sidebar preview
  // and non-collab sync — a 300 ms tail is imperceptible for those. When a
  // Yjs collab doc is active the peer sync happens via the provider, so this
  // debounce is purely for local UI state and never delays remote updates.
  const pendingEditsRef = useRef<Map<string, { html: string; timer: number }>>(new Map());
  const flushPendingEdit = useCallback((id: string) => {
    const pending = pendingEditsRef.current.get(id);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingEditsRef.current.delete(id);
    const html = pending.html;
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, body: html } : b)));
  }, []);
  // Store an html *getter* (usually `editor.getHTML`) rather than the html
  // string itself, so the (expensive) doc serialization + bookmark normalize
  // only happens once per debounce tail — NOT once per keystroke. Coupled
  // with `shouldRerenderOnTransaction: false` on the useEditor call below,
  // this keeps individual keystrokes off the React render path entirely and
  // eliminates the ~1s input latency in the Electron shell.
  const pendingGettersRef = useRef<Map<string, () => string>>(new Map());
  const handleEditorInput = useCallback((id: string, getHtml: () => string) => {
    activeEditorBlockIdRef.current = id;
    pendingGettersRef.current.set(id, getHtml);
    const existing = pendingEditsRef.current.get(id);
    if (existing) window.clearTimeout(existing.timer);
    const timer = window.setTimeout(() => {
      const getter = pendingGettersRef.current.get(id);
      pendingGettersRef.current.delete(id);
      pendingEditsRef.current.delete(id);
      if (!getter) return;
      // Idle callback keeps disk write / state commit off the keystroke
      // frame; fall back on setTimeout(0) where rIC is unavailable.
      const commit = () => {
        const normalized = normalizeBookmarkHtml(getter());
        setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, body: normalized } : b)));
      };
      type IdleWin = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
      const w = window as IdleWin;
      if (typeof w.requestIdleCallback === "function") {
        w.requestIdleCallback(commit, { timeout: 400 });
      } else {
        window.setTimeout(commit, 0);
      }
    }, 1000);
    pendingEditsRef.current.set(id, { html: "", timer });
  }, []);
  /**
   * Synchronously drain every pending debounced edit into React state.
   * MUST run before any mode transition — Prompt Mode re-renders the block
   * tree from `blocks`, so an in-flight 1s debounce would otherwise resurrect
   * stale HTML and silently erase the operator's last seconds of typing.
   */
  const flushAllPendingEdits = useCallback(() => {
    const getters = pendingGettersRef.current;
    if (getters.size === 0) return;
    const updates = new Map<string, string>();
    getters.forEach((getHtml, id) => {
      try {
        updates.set(id, normalizeBookmarkHtml(getHtml()));
      } catch {
        /* editor torn down mid-flush — skip */
      }
    });
    getters.clear();
    pendingEditsRef.current.forEach(({ timer }) => window.clearTimeout(timer));
    pendingEditsRef.current.clear();
    if (updates.size === 0) return;
    setBlocks((prev) =>
      prev.map((b) => (updates.has(b.id) ? { ...b, body: updates.get(b.id)! } : b)),
    );
  }, []);
  // Best-effort flush on unmount so no keystrokes are lost if the editor
  // tears down while a debounce is pending.
  useEffect(() => {
    const pending = pendingEditsRef.current;
    return () => {
      pending.forEach(({ timer }) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);


  const serializeEditorFragment = useCallback((editor: Editor, from: number, to: number) => {
    const wrapper = document.createElement("div");
    const fragment = editor.state.doc.content.cut(from, to);
    wrapper.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(fragment));
    // Keep every paragraph node intact — TipTap needs empty paragraphs to
    // let the user place a cursor / insert new lines. Trailing blank-line
    // appearance is handled visually in CSS (Prompt Mode only), never by
    // deleting nodes here.
    const html = wrapper.innerHTML || "<p></p>";
    return normalizeBookmarkHtml(html || "<p></p>");
  }, []);

  const splitBlockAtCursor = useCallback((id: string, editor: Editor) => {
    const cursor = editor.state.selection.from;
    const contentSize = editor.state.doc.content.size;
    const before = serializeEditorFragment(editor, 0, cursor);
    const after = serializeEditorFragment(editor, cursor, contentSize);
    const newId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    editor.commands.deleteRange({ from: cursor, to: contentSize });
    setBlocks((prev) => {
      const index = prev.findIndex((block) => block.id === id);
      if (index < 0) return prev;
      const next = [...prev];
      next[index] = { ...next[index], body: before };
      next.splice(index + 1, 0, {
        id: newId,
        title: `Block ${index + 2}`,
        body: after,
      });
      return next;
    });
    setActiveId(newId);
    requestAnimationFrame(() => requestEditScrollTo(newId));
    toast.success("Rundown block split");
  }, [requestEditScrollTo, serializeEditorFragment]);

  const removeBlockBreak = useCallback((id: string) => {
    setBlocks((prev) => {
      const index = prev.findIndex((block) => block.id === id);
      if (index <= 0) return prev;
      const previous = prev[index - 1];
      const current = prev[index];
      const merged = normalizeBookmarkHtml(`${previous.body || ""}${current.body || ""}`);
      const previousEditor = tiptapEditorsRef.current.get(previous.id);
      if (previousEditor) {
        previousEditor.commands.insertContentAt(previousEditor.state.doc.content.size, current.body || "");
      }
      const next = [...prev];
      next[index - 1] = { ...previous, body: merged };
      next.splice(index, 1);
      setActiveId(previous.id);
      requestAnimationFrame(() => requestEditScrollTo(previous.id));
      return next;
    });
    toast.success("Block break removed");
  }, [requestEditScrollTo]);

  /* ----------------------- Find & Replace (ProseMirror decorations) -----------
   * Highlighting is done entirely via the SearchAndReplace extension's inline
   * decorations — no DOM mutation, no HTML wrapping, the saved block HTML stays
   * byte-identical while a search is active. Replace ops go through PM
   * transactions and persist via each editor's onUpdate handler. */

  // Editors in document (block) order, only those currently mounted.
  const getOrderedEditors = useCallback((): { id: string; editor: Editor }[] => {
    const out: { id: string; editor: Editor }[] = [];
    for (const b of blocks) {
      const ed = tiptapEditorsRef.current.get(b.id);
      if (ed) out.push({ id: b.id, editor: ed });
    }
    return out;
  }, [blocks]);

  // Flat, ordered list of every match across every editor.
  const collectFlatMatches = useCallback(() => {
    const flat: { id: string; editor: Editor; local: number; from: number; to: number }[] = [];
    for (const { id, editor } of getOrderedEditors()) {
      const store = (editor.storage as unknown as Record<string, { results?: { from: number; to: number }[] }>)
        .searchAndReplace;
      const results = store?.results ?? [];
      results.forEach((r, local) => flat.push({ id, editor, local, from: r.from, to: r.to }));
    }
    return flat;
  }, [getOrderedEditors]);

  const findCursorRef = useRef(0);

  // Push the query/case into every mounted editor so each renders its own
  // highlight decorations, then refresh the global match counter.
  const applySearchToAll = useCallback(
    (query: string, caseSensitive: boolean) => {
      for (const { editor } of getOrderedEditors()) {
        editor.commands.setCaseSensitive(caseSensitive);
        editor.commands.setSearchTerm(query);
        editor.commands.setSearchSelectedIndex(-1);
      }
      const total = collectFlatMatches().length;
      setFindStatus({ current: 0, total });
    },
    [getOrderedEditors, collectFlatMatches],
  );

  const findStep = useCallback(
    (dir: 1 | -1) => {
      const flat = collectFlatMatches();
      if (flat.length === 0) {
        setFindStatus({ current: 0, total: 0 });
        return;
      }
      let next = findCursorRef.current + dir;
      if (next < 0) next = flat.length - 1;
      if (next >= flat.length) next = 0;
      findCursorRef.current = next;
      const target = flat[next];
      // Clear active highlight on all editors, then mark the current one.
      for (const { editor } of getOrderedEditors()) editor.commands.setSearchSelectedIndex(-1);
      target.editor.commands.setSearchSelectedIndex(target.local);
      setActiveId(target.id);
      requestEditScrollTo(target.id);
      // Set a real ProseMirror selection WITHOUT focusing the editor — focusing
      // would steal the cursor out of the Find input, so subsequent typing /
      // Enter would land in the document instead of the Find box (the "find
      // stops working after the first match" bug). Guard offsets against the
      // live doc size in case it shifted under us.
      try {
        const docSize = target.editor.state.doc.content.size;
        const from = Math.max(0, Math.min(target.from, docSize));
        const to = Math.max(from, Math.min(target.to, docSize));
        target.editor.commands.setTextSelection({ from, to });
      } catch {
        /* selection may be invalid mid-edit; highlight scroll below still runs */
      }
      // Center the active match in the viewport using the rendered decoration
      // element. This does not require editor focus.
      requestAnimationFrame(() => {
        const activeMatch =
          target.editor.view.dom.querySelector(".tp-search-result--active") ||
          target.editor.view.dom.querySelector(".tp-search-result");
        activeMatch?.scrollIntoView({ block: "center", behavior: "smooth" });
        // Pulse the active match. Adding .tp-flashing enables the CSS
        // animation; any keydown or mousedown inside the editor strips it
        // instantly so the user can start editing without a flashing halo.
        const dom = target.editor.view.dom as HTMLElement;
        dom.classList.add("tp-flashing");
        const stop = () => {
          dom.classList.remove("tp-flashing");
          dom.removeEventListener("keydown", stop, true);
          dom.removeEventListener("mousedown", stop, true);
        };
        dom.addEventListener("keydown", stop, true);
        dom.addEventListener("mousedown", stop, true);
        window.setTimeout(stop, 1500);
        // Keep keyboard focus in the Find input so repeated Enter / typing
        // continues to drive the search instead of editing the script.
        findInputRef.current?.focus();
      });
      setFindStatus({ current: next + 1, total: flat.length });
    },
    [collectFlatMatches, getOrderedEditors, requestEditScrollTo],
  );

  // Recompute matches whenever the query/case/blocks change while open.
  useEffect(() => {
    if (!findOpen) return;
    findCursorRef.current = -1;
    applySearchToAll(findQuery, findCase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findQuery, findCase, findOpen, blocks]);

  const replaceCurrent = useCallback(() => {
    if (!findQuery) return;
    const flat = collectFlatMatches();
    if (flat.length === 0) return;
    let idx = findCursorRef.current;
    if (idx < 0 || idx >= flat.length) idx = 0;
    const target = flat[idx];
    target.editor.commands.setReplaceTerm(findReplace);
    target.editor.commands.setSearchSelectedIndex(target.local);
    target.editor.commands.replaceCurrent();
    setTimeout(() => {
      applySearchToAll(findQuery, findCase);
      findCursorRef.current = idx - 1;
      findStep(1);
    }, 30);
  }, [findQuery, findReplace, findCase, collectFlatMatches, applySearchToAll, findStep]);

  const replaceAll = useCallback(() => {
    if (!findQuery) return;
    let total = 0;
    for (const { editor } of getOrderedEditors()) {
      const store = (editor.storage as unknown as Record<string, { results?: unknown[] }>).searchAndReplace;
      const n = store?.results?.length ?? 0;
      if (n === 0) continue;
      editor.commands.setReplaceTerm(findReplace);
      editor.commands.replaceAll();
      total += n;
    }
    setFindStatus({ current: 0, total: 0 });
    findCursorRef.current = -1;
    setTimeout(() => applySearchToAll(findQuery, findCase), 30);
    toast.success(`Replaced ${total} occurrence${total === 1 ? "" : "s"}`);
  }, [findQuery, findReplace, findCase, getOrderedEditors, applySearchToAll]);

  const openFind = useCallback(() => {
    setFindOpen(true);
    const sel = window.getSelection()?.toString();
    if (sel && sel.length > 0 && sel.length < 200) setFindQuery(sel);
    setTimeout(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    }, 0);
  }, []);

  // When the panel closes, clear every editor's highlight decorations.
  useEffect(() => {
    if (findOpen) return;
    for (const ed of tiptapEditorsRef.current.values()) ed.commands.clearSearch();
  }, [findOpen]);

  /** BlockEditor mount/unmount → keep editorsRef in sync. */
  const registerEditorRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      editorsRef.current.set(id, el);
      // First mount with no current editor: make it the default target.
      if (!editorRef.current) {
        editorRef.current = el;
        activeEditorBlockIdRef.current = id;
      }
    } else {
      editorsRef.current.delete(id);
      if (activeEditorBlockIdRef.current === id) {
        editorRef.current = null;
        activeEditorBlockIdRef.current = null;
      }
    }
  }, []);

  /** BlockEditor mount/unmount → keep the TipTap instance registry in sync. */
  const registerTiptapEditor = useCallback((id: string, editor: Editor | null) => {
    if (editor) tiptapEditorsRef.current.set(id, editor);
    else tiptapEditorsRef.current.delete(id);
  }, []);

  /** The TipTap editor that should receive toolbar / bookmark commands. */
  const getActiveTiptap = useCallback((): Editor | null => {
    const id = activeEditorBlockIdRef.current ?? activeId ?? null;
    if (id && tiptapEditorsRef.current.has(id)) return tiptapEditorsRef.current.get(id)!;
    // Fallback: any focused editor, else the first registered one.
    for (const ed of tiptapEditorsRef.current.values()) {
      if (ed.isFocused) return ed;
    }
    const first = tiptapEditorsRef.current.values().next();
    return first.done ? null : first.value;
  }, [activeId]);

  /** Resolve the TipTap editor that owns a given DOM node (used to sync native
   *  DOM ranges produced by navigation/bookmark helpers into ProseMirror). */
  const tiptapForDomNode = useCallback((node: Node | null): Editor | null => {
    const el =
      node && (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement);
    const owner = el?.closest<HTMLElement>("[data-block-editor]");
    const id = owner?.getAttribute("data-block-id");
    return id ? (tiptapEditorsRef.current.get(id) ?? null) : null;
  }, []);

  /** Convert a native DOM range into a ProseMirror text selection so caret
   *  placement done via window.getSelection() actually sticks in the editor. */
  const syncDomRangeToTiptap = useCallback(
    (range: Range) => {
      try {
        const ed = tiptapForDomNode(range.startContainer);
        if (!ed) return;
        const a = ed.view.posAtDOM(range.startContainer, range.startOffset);
        const b = ed.view.posAtDOM(range.endContainer, range.endOffset);
        ed.chain()
          .focus()
          .setTextSelection({ from: Math.min(a, b), to: Math.max(a, b) })
          .run();
      } catch {
        /* posAtDOM can throw for detached nodes — ignore. */
      }
    },
    [tiptapForDomNode],
  );

  // Prompt mode: when user picks a block in the rundown, scroll to its heading.
  useEffect(() => {
    if (mode !== "prompt" || !activeId) return;
    if (!displayOnly && settings.snapToCursor) return;
    // If a precise jump (block + offset) is pending, defer to the dedicated
    // effect below so we don't double-scroll.
    if (pendingPromptJumpRef.current) return;
    const text = textRef.current;
    if (!text) return;
    const node = text.querySelector<HTMLElement>(`[data-block-heading="${activeId}"]`);
    if (!node) return;
    const baseTop = text.getBoundingClientRect().top;
    const headingY = node.getBoundingClientRect().top - baseTop + scrollYRef.current;
    // Align the active block's heading with the eyeline (not the top of the
    // canvas) so the previous block stays visible above it. This is the
    // Continuous Canvas — scrolling up from Block 2 reveals Block 1 directly.
    const eye = (settings.eyelineY || 0.5) * window.innerHeight;
    const target = Math.max(0, headingY - eye);
    speedRef.current = 0;
    setSpeed(0);
    scrollYRef.current = target;
    setScrollY(target);
    broadcastNow({
      playing: false,
      speed: 0,
      scrollY: target,
      blank: blankRef.current,
      activeBookmark: null,
      tieDyeActive: tieDyeRef.current,
      ts: Date.now(),
    });
  }, [activeId, mode, displayOnly, settings.snapToCursor, settings.eyelineY, broadcastNow]);

  // Honor a pending precise prompt jump (Cmd+Enter handoff or rundown
  // double-click). Runs after the prompt canvas has rendered.
  useEffect(() => {
    if (mode !== "prompt") return;
    let cancelled = false;
    let secondFrame = 0;
    const applyPromptAnchor = () => {
      if (cancelled) return;
      const scrollContainer = containerRef.current;
      const text = textRef.current;
      if (!scrollContainer || !text) return;

      // Re-kill momentum after layout as well as on the mode flip. This closes
      // the race where the RAF engine runs between React commit and anchor
      // restoration.
      speedRef.current = 0;
      currentSpeedRef.current = 0;
      smoothedTargetRef.current = 0;
      keysRef.current.left = false;
      keysRef.current.right = false;
      setSpeed(0);
      const minScroll = 0;
      const maxScroll = Math.max(
        minScroll,
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
      );

      let target: number | null = null;
      const pendingScroll = pendingPromptScrollRef.current;
      if (pendingScroll !== null) {
        target = Math.max(minScroll, Math.min(pendingScroll, maxScroll));
        pendingPromptScrollRef.current = null;
        pendingPromptJumpRef.current = null;
      } else {
        const pending = pendingPromptJumpRef.current;
        if (!pending) return;
        const node = text.querySelector<HTMLElement>(
          `[data-block-heading="${cssEscape(pending.blockId)}"]`,
        );
        if (!node) return;
        // Pixel snap instead of scrollIntoView/getBoundingClientRect. The
        // heading is a direct prompt-canvas child, so offsetTop includes the
        // freshly painted 80vh top spacer and is immune to the active
        // translateY transform.
        // offsetTop lives in the UNSCALED coordinate space of whichever
        // offsetParent the CSS transform wrapper establishes, so measure with
        // rects instead: both rects are affected by the same scale/translate,
        // which yields the true painted document offset.
        const nodeRect = node.getBoundingClientRect();
        const textRect = text.getBoundingClientRect();
        const headingY = nodeRect.top - textRect.top;
        const targetY =
          headingY - scrollContainer.clientHeight / 2 + nodeRect.height / 2 + pending.offset;
        target = Math.max(
          minScroll,
          Math.min(targetY, maxScroll),
        );
        pendingPromptJumpRef.current = null;
      }

      // Brute-force a native pixel snap first, then hand the same coordinate
      // to the transform engine. Reset native scrollTop before paint so only
      // one scrolling mechanism affects the rendered position.
      scrollContainer.scrollTop = target;
      scrollYRef.current = target;
      text.style.transform = `translate3d(0, ${-target}px, 0)`;
      lastTransformYRef.current = target;
      scrollContainer.scrollTop = 0;
      setScrollY(target);
      broadcastNow({
        playing: false,
        speed: 0,
        scrollY: target,
        blank: blankRef.current,
        activeBookmark: null,
        tieDyeActive: tieDyeRef.current,
        ts: Date.now(),
      });
    };

    // Wait for React to commit the explicit 80vh lead-in/lead-out elements,
    // then wait two browser paints before reading scrollHeight.
    const timer = window.setTimeout(() => {
      requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(applyPromptAnchor);
      });
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [mode, blocks, activeId, settings.eyelineY, broadcastNow]);

  // ---------- Seamless Mode Handoff ----------
  // Capture the current vertical "anchor" right before Edit → Prompt so the
  // prompt canvas opens at the same line the operator was working on. Priority:
  //   1) Live text caret in an editor → use its block + caret pixel offset.
  //   2) Last saved selection → use that block + a best-effort offset.
  //   3) Fall back to whichever block heading is closest to the vertical
  //      center of the edit viewport.
  const captureEditToPromptAnchor = useCallback(() => {
    try {
      // Priority 1: pick the block heading closest to viewport center and
      // remember its pixel offset. This survives the layout differences
      // between Edit Mode (native scroll, no padding) and Prompt Mode
      // (transform scroll, 80vh top spacer) — a raw scrollTop passthrough
      // would visibly jump because the two surfaces don't share a scroll
      // origin. See the mirror consumer effect below.
      const text = textRef.current;
      const container = containerRef.current;
      if (text && container) {
        const viewport = window.innerHeight;
        const centerViewport = viewport / 2;
        const headings = Array.from(
          text.querySelectorAll<HTMLElement>("[data-block-heading]"),
        );
        let bestId: string | null = null;
        let bestDelta = Infinity;
        for (const h of headings) {
          // getBoundingClientRect() is already viewport-relative (scroll is
          // baked in), so do NOT subtract container.scrollTop again — that
          // double-count is what made an end-of-script handoff overshoot by
          // the entire scroll distance and land in the black.
          const relToViewport = h.getBoundingClientRect().top;
          const delta = centerViewport - relToViewport;
          if (delta >= 0 && delta < bestDelta) {
            bestDelta = delta;
            bestId = h.getAttribute("data-block-heading");
          }
        }
        void container;
        if (bestId) {
          pendingPromptScrollRef.current = null;
          pendingPromptJumpRef.current = { blockId: bestId, offset: bestDelta };
          return;
        }
      }
      // Priority 2: live caret in a focused editor (used when no heading is
      // visible above the eyeline — e.g. very top of the doc).
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        const editorEl =
          (r.commonAncestorContainer as HTMLElement | null)?.parentElement?.closest?.<HTMLElement>(
            "[data-block-editor]",
          ) ??
          (r.commonAncestorContainer as HTMLElement | null)?.closest?.<HTMLElement>(
            "[data-block-editor]",
          );
        if (editorEl) {
          const blockId = editorEl.getAttribute("data-block-editor") || activeId;
          if (blockId) {
            const caretRect = r.getClientRects()[0];
            const editorTop = editorEl.getBoundingClientRect().top;
            const offset = caretRect ? caretRect.top - editorTop : 0;
            pendingPromptJumpRef.current = { blockId, offset: Math.max(0, offset) };
            return;
          }
        }
      }
      // Priority 3: saved (toolbar-side) selection memory.
      const saved = savedSelectionRef.current ?? formatSelectionRef.current;
      if (saved?.blockId) {
        pendingPromptJumpRef.current = { blockId: saved.blockId, offset: 0 };
        return;
      }
      if (activeId) pendingPromptJumpRef.current = { blockId: activeId, offset: 0 };
    } catch (err) {
      console.warn("captureEditToPromptAnchor failed", err);
    }
  }, [activeId]);

  // Capture the anchor for Prompt → Edit using the block currently sitting at
  // (or just above) the prompter eyeline.
  const capturePromptToEditAnchor = useCallback(() => {
    try {
      const text = textRef.current;
      if (!text) {
        pendingEditJumpRef.current = null;
        return;
      }
      const eye = (settings.eyelineY || 0.5) * window.innerHeight;
      const cursor = scrollYRef.current + eye;
      const baseTop = text.getBoundingClientRect().top + scrollYRef.current;
      const headings = Array.from(text.querySelectorAll<HTMLElement>("[data-block-heading]"));
      let bestId: string | null = null;
      let bestY = -Infinity;
      for (const h of headings) {
        const y = h.getBoundingClientRect().top + scrollYRef.current - baseTop;
        if (y <= cursor && y > bestY) {
          bestY = y;
          bestId = h.getAttribute("data-block-heading");
        }
      }
      if (!bestId && headings[0]) {
        bestId = headings[0].getAttribute("data-block-heading");
        bestY = headings[0].getBoundingClientRect().top + scrollYRef.current - baseTop;
      }
      if (bestId) {
        pendingEditJumpRef.current = { blockId: bestId, offset: Math.max(0, cursor - bestY) };
        lastPromptAnchorBlockIdRef.current = bestId;
      }
    } catch (err) {
      console.warn("capturePromptToEditAnchor failed", err);
    }
  }, [settings.eyelineY]);

  // Consume pendingEditJumpRef once the edit canvas has painted. We wrap in
  // a double rAF + setTimeout fallback because contentEditable blocks measure
  // 0px until the browser has laid them out.
  useEffect(() => {
    if (mode !== "edit") return;
    const pending = pendingEditJumpRef.current;
    if (!pending) return;
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      const container = containerRef.current;
      const text = textRef.current;
      if (!container || !text) return;
      const node = text.querySelector<HTMLElement>(
        `[data-block-heading="${cssEscape(pending.blockId)}"]`,
      );
      if (!node) return;
      const baseTop = text.getBoundingClientRect().top + container.scrollTop;
      const headingY = node.getBoundingClientRect().top + container.scrollTop - baseTop;
      const eye = (settings.eyelineY || 0.5) * window.innerHeight;
      const target = Math.max(0, headingY + pending.offset - eye);
      container.scrollTop = target;
      scrollYRef.current = target;
      pendingEditJumpRef.current = null;
    };
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(apply);
      // Safety net for slow contentEditable layout passes.
      setTimeout(() => {
        if (pendingEditJumpRef.current) apply();
      }, 80);
      return () => cancelAnimationFrame(r2);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(r1);
    };
  }, [mode, settings.eyelineY]);

  // Tiny wrapper so every call site that flips modes also runs the right
  // anchor capture in the same tick.
  const switchMode = useCallback(
    (next: Mode) => {
      const current = modeRef.current;
      if (current === next) return;
      // RBAC: a remote `viewer` (no edit-in-edit-mode grant) is locked into
      // Prompt Mode and can never reach the editing surface.
      if (
        next === "edit" &&
        roleRef.current === "client" &&
        !selfPermissionsRef.current.editInEditMode
      ) {
        notifyLocked();
        return;
      }
      if (current === "edit" && next === "prompt") {
        // Data-loss guard: commit any debounced keystrokes BEFORE the tree
        // re-renders from `blocks`.
        flushAllPendingEdits();
        captureEditToPromptAnchor();
        // TTS safety: kill any narration the instant the host goes live.
        ttsCancel();
        // Prompt Mode is a clean output surface. Close every piece of host UI
        // before the handoff so no portalled dialog/popover survives over it.
        setParticipantsOpen(false);
        setSessionModalOpen(false);
        setFindOpen(false);
        setStageTimerOpen(false);
        setMarkerPickerOpen(false);
        setBookmarksOpen(false);
        setArrowMenuOpen(false);
        setNewShowOpen(false);
        setCloseRoomConfirmOpen(false);
      }
      else if (current === "prompt" && next === "edit") capturePromptToEditAnchor();
      setMode(next);
    },
    [captureEditToPromptAnchor, capturePromptToEditAnchor, notifyLocked, flushAllPendingEdits],
  );

  // Create / tear down the Yjs collaboration layer for the active session.
  useEffect(() => {
    if (!pin || !user || displayOnly) {
      setCollab(null);
      return;
    }
    // Role-aware cursor label: everyone observing the document sees both the
    // user's name and their role (e.g. "Vanessa - Second Op").
    const baseName = (lobbyName.trim() || user.name?.trim() || "Player");
    const roleLabel = role === "host" ? "Host" : selfRoleLabel.trim();
    const displayName = roleLabel ? `${baseName} - ${roleLabel}` : baseName;
    const userMeta = {
      name: displayName,
      color: colorForUserId(user.id),
      role: roleLabel,
    };
    const doc = new Y.Doc();
    // Local-First: bind IndexedDB persistence BEFORE the network provider.
    // The editor mounts against the local cache immediately (zero network
    // latency) and any Supabase Realtime failure just leaves the doc in
    // its cached state — Yjs replays queued updates once we reconnect.
    let persistence: IndexeddbPersistence | null = null;
    try {
      persistence = new IndexeddbPersistence(`promptinc-${pin}`, doc);
    } catch (err) {
      // Private-mode Safari / storage-blocked browsers throw here; we still
      // want the collaboration layer to come up, just without offline cache.
      // eslint-disable-next-line no-console
      console.warn("[Yjs] IndexedDB persistence unavailable:", err);
    }
    const provider = new SupabaseYjsProvider(pin, doc, userMeta);
    setCollab({ doc, provider, user: userMeta });
    return () => {
      setCollab(null);
      // CRITICAL: never destroy the Yjs doc synchronously. The TipTap editors
      // are still mounted with the Collaboration plugin bound to this doc; a
      // synchronous destroy throws inside ProseMirror and trips the React
      // error boundary (the "Leave crashes the app" bug). Defer teardown so
      // the editors remount in solo (non-collab) mode first, keeping the
      // script fully intact.
      const teardown = () => {
        try { provider.destroy(); } catch { /* already gone */ }
        try { persistence?.destroy(); } catch { /* already gone */ }
        try { doc.destroy(); } catch { /* already gone */ }
      };
      setTimeout(teardown, 300);
    };
  }, [pin, user, displayOnly, role, lobbyName, selfRoleLabel]);

  // Fix 'Locked After Prompt Mode': returning to Edit must hand focus back to
  // the canvas, otherwise the editor looks read-only until the user clicks.
  useEffect(() => {
    if (mode !== "edit" || displayOnly || role !== "host") return;
    const id = window.setTimeout(() => {
      // If focus is already inside an editable (e.g. the Rundown sidebar
      // input the user just clicked), do NOT yank it back to the main
      // canvas — that steals the caret from sidebar blocks 2+ and makes
      // them appear un-editable.
      const ae = document.activeElement as HTMLElement | null;
      if (
        ae &&
        (ae.isContentEditable ||
          ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA")
      ) {
        return;
      }
      // Respect the Prompt → Edit anchor: focus the editor for the block the
      // operator was reading at the eyeline, and never scroll — the anchor
      // effect already positioned the canvas.
      const anchorId = lastPromptAnchorBlockIdRef.current;
      const ed =
        (anchorId ? tiptapEditorsRef.current.get(anchorId) : null) ?? getActiveTiptap();
      try {
        ed?.commands.focus(undefined, { scrollIntoView: false });
      } catch {
        /* editor may be mid-remount — ignore */
      }
      lastPromptAnchorBlockIdRef.current = null;
    }, 140);
    return () => window.clearTimeout(id);
  }, [mode, displayOnly, role, getActiveTiptap]);

  // Emergency force-show: if prompt mode is not blanked but the canvas has no visible script,
  // remount the rendered HTML once so a stale transformed/empty node cannot stay black.
  useEffect(() => {
    if (mode !== "prompt" || blank || forceShowKey > 2) return;
    const id = requestAnimationFrame(() => {
      const text = textRef.current;
      const hasScript = promptBlocks.some((b) => (b.body ?? "").trim().length > 0);
      const visibleText = (text?.textContent ?? "").trim().length > 0;
      const hasHeight = (text?.scrollHeight ?? 0) > 0;
      if (hasScript && (!visibleText || !hasHeight)) setForceShowKey((k) => k + 1);
    });
    return () => cancelAnimationFrame(id);
  }, [mode, blank, promptBlocks, forceShowKey]);

  // Track which non-ghosted block is currently under the eyeline. Drives the
  // tiny HUD indicator (bottom-left) so the operator always knows where they
  // are. Computed locally — never broadcast.
  useEffect(() => {
    if (mode !== "prompt") return;
    const text = textRef.current;
    if (!text) return;
    const eye = (settings.eyelineY || 0.5) * window.innerHeight;
    const baseTop = text.getBoundingClientRect().top + scrollYRef.current;
    const cursor = scrollYRef.current + eye;
    let currentTitle = "";
    for (const b of promptBlocks) {
      const el = text.querySelector<HTMLElement>(`[data-block-heading="${cssEscape(b.id)}"]`);
      if (!el) continue;
      const y = el.getBoundingClientRect().top + scrollYRef.current - baseTop;
      if (y <= cursor + 4) currentTitle = b.title || "";
      else break;
    }
    if (!currentTitle && promptBlocks[0]) currentTitle = promptBlocks[0].title || "";
    setVisibleBlockTitle((prev) => (prev === currentTitle ? prev : currentTitle));
  }, [mode, scrollY, promptBlocks, settings.eyelineY]);

  // ---- Bookmark navigation ----
  // Only user-placed bookmarks (skip the synthetic "block-<id>" anchors that
  // every block wrapper carries).
  const PROMPT_BOOKMARK_SELECTOR = '[data-bookmark]:not([data-bookmark^="block-"])';

  // Prompt-mode DOM traversal: walk every rendered bookmark span via its
  // viewport bounding rect, compare against the eyeline pixel, and update
  // the prompt scroll engine (scrollYRef + translate3d) so the target snaps
  // to the eyeline. Does not rely on any editor instance.
  const jumpBookmark = (dir: 1 | -1) => {
    const text = textRef.current;
    if (!text) return;
    const bookmarks = Array.from(
      text.querySelectorAll<HTMLElement>(`.prompt-bookmark, ${PROMPT_BOOKMARK_SELECTOR}`),
    );
    if (!bookmarks.length) return;

    const eyelinePx = (settings.eyelineY || 0.5) * window.innerHeight;
    // Map each bookmark to its viewport-top in pixels.
    const items = bookmarks
      .map((el) => ({ el, top: el.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top);

    const TOL = 4;
    let target: { el: HTMLElement; top: number } | undefined;
    if (dir === 1) {
      target = items.find((it) => it.top > eyelinePx + TOL);
    } else {
      // closest above the eyeline → walk sorted list and keep last match.
      for (const it of items) {
        if (it.top < eyelinePx - TOL) target = it;
        else break;
      }
    }
    if (!target) return;

    // Convert viewport delta → content delta and update the rAF scroll engine.
    const delta = target.top - eyelinePx;
    const text2 = textRef.current;
    const containerH = containerRef.current?.clientHeight ?? window.innerHeight;
    const max = text2 ? Math.max(0, text2.scrollHeight - containerH) : Infinity;
    const next = Math.max(0, Math.min(max, scrollYRef.current + delta));

    speedRef.current = 0;
    setSpeed(0);
    scrollYRef.current = next;
    setScrollY(next);
    broadcastNow({
      playing: false,
      speed: 0,
      scrollY: next,
      blank: blankRef.current,
      activeBookmark: null,
      ts: Date.now(),
    });
  };

  // Tag every rendered manual bookmark span with `.prompt-bookmark` so the
  // traversal selector above can find them. Re-run whenever the prompt
  // content changes.
  useEffect(() => {
    if (mode !== "prompt") return;
    const text = textRef.current;
    if (!text) return;
    const tag = () => {
      text
        .querySelectorAll<HTMLElement>(PROMPT_BOOKMARK_SELECTOR)
        .forEach((el) => el.classList.add("prompt-bookmark"));
    };
    tag();
    const mo = new MutationObserver(tag);
    mo.observe(text, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [mode, promptBlocks, forceShowKey]);

  // Dedicated Prompt-mode key listener for Cmd/Ctrl+[ and Cmd/Ctrl+] so
  // the browser cannot hijack them for history Back/Forward. Uses
  // stopImmediatePropagation to keep the global keymap from double-firing.
  useEffect(() => {
    if (mode !== "prompt" || displayOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const dir: 1 | -1 | null =
        e.key === "]" || e.code === "BracketRight"
          ? 1
          : e.key === "[" || e.code === "BracketLeft"
            ? -1
            : null;
      if (!dir) return;
      const withMod = e.metaKey || e.ctrlKey;
      // Accept both modifier and bare bracket presses while in prompt mode.
      if (!withMod) {
        const t = e.target as HTMLElement | null;
        const inField =
          t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
        if (inField) return;
      }
      if (e.altKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      jumpBookmark(dir);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, displayOnly, settings.eyelineY]);

  // Edit-mode bookmark jump: walk every <span data-bookmark> across all block
  // editors in document order, find the one strictly after/before the current
  // caret, move the selection there, and scroll it into view.
  const jumpBookmarkInEditor = (dir: 1 | -1) => {
    const editors = Array.from(document.querySelectorAll<HTMLElement>("[data-block-editor]"));
    const marks: HTMLElement[] = [];
    editors.forEach((ed) => {
      ed.querySelectorAll<HTMLElement>('[data-bookmark]:not([data-bookmark^="block-"])').forEach(
        (m) => marks.push(m),
      );
    });
    if (marks.length === 0) return;

    // Determine caret reference point.
    const sel = window.getSelection();
    let refNode: Node | null = null;
    let refOffset = 0;
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      refNode = r.startContainer;
      refOffset = r.startOffset;
    } else if (lastRangeRef.current) {
      refNode = lastRangeRef.current.startContainer;
      refOffset = lastRangeRef.current.startOffset;
    }

    // Build a numeric position for each bookmark. Since querySelectorAll
    // returns nodes in document order, the index itself IS the position.
    // Sort explicitly (ascending) per spec — mutation-safe via slice().
    const indexed = marks.map((mark, idx) => ({ mark, pos: idx }));
    const sortedPositions = indexed.slice().sort((a, b) => a.pos - b.pos);

    // Classify every bookmark relative to the caret using its FULL span,
    // not just its start. After a jump the caret sits immediately AFTER a
    // bookmark span, so a start-only comparison would treat that same
    // bookmark as "before" the caret and Previous would snap back onto it.
    // A mark counts as "before" only when its END is at/behind the caret,
    // and "after" only when its START is at/ahead of the caret. The mark the
    // caret is sitting inside/just-after is neither, so it's skipped.
    const beforeCaret: { mark: HTMLElement; pos: number }[] = [];
    const afterCaret: { mark: HTMLElement; pos: number }[] = [];
    let caretRange: Range | null = null;
    if (refNode) {
      caretRange = document.createRange();
      caretRange.setStart(refNode, refOffset);
      caretRange.collapse(true);
    }
    for (const it of sortedPositions) {
      if (!caretRange) {
        afterCaret.push(it);
        continue;
      }
      const mr = document.createRange();
      mr.selectNode(it.mark);
      // caretRange.compareBoundaryPoints(END_TO_START, mr): caret.start vs mark.end
      //   > 0  → caret is after the mark's end  → mark is strictly before caret
      // caretRange.compareBoundaryPoints(START_TO_END, mr): caret.end vs mark.start
      //   < 0  → caret is before the mark's start → mark is strictly after caret
      if (caretRange.compareBoundaryPoints(Range.END_TO_START, mr) > 0) {
        beforeCaret.push(it);
      } else if (caretRange.compareBoundaryPoints(Range.START_TO_END, mr) < 0) {
        afterCaret.push(it);
      }
    }

    let targetItem: { mark: HTMLElement; pos: number } | null = null;
    if (dir === 1) {
      // Next: closest bookmark after the caret, else cycle to first.
      targetItem = afterCaret.length > 0 ? afterCaret[0] : sortedPositions[0];
    } else {
      // Previous: closest bookmark before the caret, else cycle to last.
      targetItem =
        beforeCaret.length > 0
          ? beforeCaret[beforeCaret.length - 1]
          : sortedPositions[sortedPositions.length - 1];
    }
    if (!targetItem) return;
    const target = targetItem.mark;

    // Focus the owning editor, place caret just after the bookmark span.
    const ownerEditor = target.closest<HTMLElement>("[data-block-editor]");
    if (ownerEditor) {
      const ownerId = ownerEditor.getAttribute("data-block-editor");
      if (ownerId) {
        activeEditorBlockIdRef.current = ownerId;
        setActiveId(ownerId);
      }
      ownerEditor.focus({ preventScroll: true });
    }
    const after = document.createRange();
    after.setStartAfter(target);
    after.collapse(true);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(after);
    lastRangeRef.current = after.cloneRange();
    syncDomRangeToTiptap(after);
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Cmd+] / Cmd+[ — navigate between non-ghosted blocks.
  // Edit mode: switch active block. Prompt mode: scroll the continuous canvas
  // so the next/prev block heading aligns with the eyeline.
  const jumpBlock = useCallback(
    (dir: 1 | -1) => {
      const visible = blocks.filter((b) => !b.ghosted);
      if (visible.length === 0) return;
      if (modeRef.current === "edit") {
        const idx = visible.findIndex((b) => b.id === activeId);
        const nextIdx =
          idx < 0
            ? dir === 1
              ? 0
              : visible.length - 1
            : Math.max(0, Math.min(visible.length - 1, idx + dir));
        const next = visible[nextIdx];
        if (next) {
          if (next.id !== activeId) setActiveId(next.id);
          // Continuous canvas: switching active block in Edit mode also scrolls
          // that block into view at the eyeline.
          pendingEditScrollRef.current = { id: next.id };
          setEditScrollSignal((s) => s + 1);
        }
        return;
      }
      // Prompt mode — find current block based on scroll position, jump to neighbour.
      const text = textRef.current;
      if (!text) return;
      const baseTop = text.getBoundingClientRect().top;
      const eye = (settings.eyelineY || 0.5) * window.innerHeight;
      const positions = visible.map((b) => {
        const el = text.querySelector<HTMLElement>(`[data-block-heading="${cssEscape(b.id)}"]`);
        const y = el
          ? el.getBoundingClientRect().top - baseTop + scrollYRef.current
          : Number.POSITIVE_INFINITY;
        return { id: b.id, y };
      });
      const cursor = scrollYRef.current + eye;
      let curIdx = 0;
      for (let i = 0; i < positions.length; i++) {
        if (positions[i].y <= cursor + 4) curIdx = i;
      }
      const targetIdx = Math.max(0, Math.min(positions.length - 1, curIdx + dir));
      const target = Math.max(0, positions[targetIdx].y - eye);
      speedRef.current = 0;
      setSpeed(0);
      scrollYRef.current = target;
      setScrollY(target);
      broadcastNow({
        playing: false,
        speed: 0,
        scrollY: target,
        blank: blankRef.current,
        activeBookmark: null,
        tieDyeActive: tieDyeRef.current,
        snapNodeId: null,
        snapBlockId: positions[targetIdx].id,
        snapOffset: 0,
        ts: Date.now(),
      });
    },
    [blocks, activeId, settings.eyelineY, broadcastNow],
  );

  // ---- Bookmark list (headings + manual) -------------------------------
  type BookmarkItem =
    | { kind: "heading"; blockId: string; label: string }
    | { kind: "manual"; blockId: string; bookmarkId: string; label: string; blockTitle: string };

  const bookmarkItems = useMemo<BookmarkItem[]>(() => {
    const items: BookmarkItem[] = [];
    const hasParser = typeof window !== "undefined" && typeof DOMParser !== "undefined";
    for (const b of blocks) {
      items.push({ kind: "heading", blockId: b.id, label: b.title || "(untitled)" });
      const html = b.body ?? "";
      if (!html.includes("data-bookmark")) continue;
      if (!hasParser) continue;
      const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
      const spans = doc.querySelectorAll<HTMLElement>("[data-bookmark]");
      spans.forEach((span) => {
        const id = span.getAttribute("data-bookmark") || "";
        if (!id) return;
        // Snippet: text after the bookmark, fall back to text before.
        const after = (span.nextSibling?.textContent ?? "").trim();
        const parentText = (span.parentElement?.textContent ?? "").trim();
        let label = after || parentText || "Bookmark";
        label = label.replace(/\s+/g, " ").slice(0, 60);
        if (!label) label = "Bookmark";
        items.push({
          kind: "manual",
          blockId: b.id,
          bookmarkId: id,
          label,
          blockTitle: b.title || "(untitled)",
        });
      });
    }
    return items;
  }, [blocks]);

  const scrollPromptToBookmark = useCallback(
    (selector: string) => {
      const text = textRef.current;
      if (!text) return false;
      const node = text.querySelector<HTMLElement>(selector);
      if (!node) return false;
      const baseTop = text.getBoundingClientRect().top;
      const target = node.getBoundingClientRect().top - baseTop + scrollYRef.current;
      speedRef.current = 0;
      setSpeed(0);
      scrollYRef.current = target;
      setScrollY(target);
      broadcastNow({
        playing: false,
        speed: 0,
        scrollY: target,
        blank: blankRef.current,
        activeBookmark: null,
        tieDyeActive: tieDyeRef.current,
        ts: Date.now(),
      });
      return true;
    },
    [broadcastNow],
  );

  const jumpToBookmarkItem = useCallback(
    (item: BookmarkItem) => {
      if (mode === "prompt") {
        const sel =
          item.kind === "heading"
            ? `[data-bookmark="block-${item.blockId}"]`
            : `[data-bookmark="${CSS.escape(item.bookmarkId)}"]`;
        // Ensure active block matches so any heading-tracking stays in sync.
        if (activeId !== item.blockId) setActiveId(item.blockId);
        // Defer until DOM updates if we just changed activeId.
        requestAnimationFrame(() => scrollPromptToBookmark(sel));
      } else {
        // Edit mode — every non-ghosted block lives in the same continuous
        // canvas, so we can scroll directly to the target node inside textRef
        // regardless of which editor currently has focus (critical for mobile,
        // where tapping a popover item never focuses an editor first).
        if (activeId !== item.blockId) setActiveId(item.blockId);
        const sel =
          item.kind === "heading"
            ? `[data-block-id="${CSS.escape(item.blockId)}"]`
            : `[data-bookmark="${CSS.escape(item.bookmarkId)}"]`;
        requestAnimationFrame(() => {
          const el = textRef.current?.querySelector<HTMLElement>(sel);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          } else if (item.kind === "manual") {
            pendingBookmarkRef.current = item.bookmarkId;
          }
        });
      }
    },
    [mode, activeId, scrollPromptToBookmark],
  );

  // After editor renders a new block in edit mode, honor any pending jump.
  useEffect(() => {
    if (mode !== "edit") return;
    const id = pendingBookmarkRef.current;
    if (!id) return;
    const el = editorRef.current?.querySelector<HTMLElement>(`[data-bookmark="${CSS.escape(id)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      pendingBookmarkRef.current = null;
    }
  }, [activeBlock?.id, mode]);

  // ---- Editor helpers ----
  const editorForNode = (node: Node | null): HTMLDivElement | null => {
    const element = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
    return element?.closest<HTMLDivElement>("[data-block-editor]") ?? null;
  };

  const repaintSelectionMemory = () => {
    const memory = savedSelectionRef.current;
    const editor = memory ? editorsRef.current.get(memory.blockId) : null;
    const range = memory && editor ? textOffsetsToRange(editor, memory.start, memory.end) : null;
    paintRangeHighlight(MAIN_SELECTION_HIGHLIGHT, range && !range.collapsed ? range : null);
  };

  const rememberSelectionMemory = (memory: SavedTextSelection | null) => {
    savedSelectionRef.current = memory;
    formatSelectionRef.current = memory;
    repaintSelectionMemory();
  };

  const saveSelectionNow = (ignoreToolbarGuard = false) => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const editor =
        editorForNode(range.commonAncestorContainer) ?? editorForNode(range.startContainer);
      if (editor && editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
        editorRef.current = editor;
        activeEditorBlockIdRef.current = editor.dataset.blockId ?? activeEditorBlockIdRef.current;
        if (editor.dataset.blockId)
          setActiveId((prev) =>
            prev === editor.dataset.blockId ? prev : (editor.dataset.blockId ?? prev),
          );
        lastRangeRef.current = range.cloneRange();
        if (!range.collapsed) {
          formatRangeRef.current = range.cloneRange();
          const blockId = editor.dataset.blockId;
          if (blockId) rememberSelectionMemory({ blockId, ...rangeToTextOffsets(editor, range) });
        } else if (!toolbarSelectionGuardRef.current) {
          formatRangeRef.current = null;
          rememberSelectionMemory(null);
        }
      } else if (toolbarSelectionGuardRef.current && !ignoreToolbarGuard) {
        return;
      }
    }
  };

  /**
   * Keystroke hot path: TipTap fires `onSelectionUpdate` for every character,
   * and each call re-measures the DOM range and repaints selection memory.
   * Coalesce to one run per animation frame so typing never pays for it more
   * than once a frame (this was the Chrome stutter).
   */
  const saveSelectionRafRef = useRef<number | null>(null);
  const saveSelection = () => {
    if (typeof window === "undefined") return;
    if (saveSelectionRafRef.current !== null) return;
    saveSelectionRafRef.current = window.requestAnimationFrame(() => {
      saveSelectionRafRef.current = null;
      try {
        saveSelectionNow(false);
      } catch {
        /* selection bookkeeping must never break typing */
      }
    });
  };
  const saveSelectionForToolbar = () => {
    saveSelectionNow(true);
    toolbarSelectionGuardRef.current = true;
    window.setTimeout(() => {
      toolbarSelectionGuardRef.current = false;
    }, 250);
  };
  const protectToolbarSelection = (event?: React.MouseEvent | React.PointerEvent) => {
    saveSelectionForToolbar();
    event?.preventDefault();
  };

  useEffect(() => {
    const onSel = () => saveSelection();
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  useEffect(() => {
    repaintSelectionMemory();
    return () => clearRangeHighlight(MAIN_SELECTION_HIGHLIGHT);
  }, [blocks]);

  // Snap-to-cursor: the host always broadcasts the caret's active block + Y-offset
  // (relative to the editor's top) on selectionchange/keyup/click so the extended
  // display centers that exact line on the eyeline. Tracking is the text caret —
  // never the mouse pointer.
  useEffect(() => {
    if (displayOnly) return;
    if (mode !== "edit" || role !== "host" || !settings.snapToCursor) {
      if (snapRef.current) {
        snapRef.current = null;
        broadcastNow(getState());
      }
      return;
    }
    let raf = 0;
    const send = () => {
      const block = activeBlock;
      if (!block) return;
      const nodeId = getCaretPromptNodeId();
      const offset = getCaretOffsetInEditor();
      const prev = snapRef.current;
      if (
        prev &&
        prev.blockId === block.id &&
        prev.nodeId === nodeId &&
        Math.abs(prev.offset - offset) < 2
      )
        return;
      snapRef.current = { blockId: block.id, nodeId, offset };
      broadcastNow(getState());
    };
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(send);
    };
    document.addEventListener("selectionchange", onChange);
    const el = editorRef.current;
    el?.addEventListener("input", onChange);
    el?.addEventListener("click", onChange);
    el?.addEventListener("keyup", onChange);
    // Send an initial position when the toggle flips on.
    onChange();
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", onChange);
      el?.removeEventListener("input", onChange);
      el?.removeEventListener("click", onChange);
      el?.removeEventListener("keyup", onChange);
    };
  }, [settings.snapToCursor, mode, role, displayOnly, activeBlock, broadcastNow, getState]);

  const restoreSelection = () => {
    const saved = savedSelectionRef.current ?? formatSelectionRef.current;
    const savedEditor = saved ? editorsRef.current.get(saved.blockId) : null;
    const r = savedEditor
      ? textOffsetsToRange(savedEditor, saved!.start, saved!.end)
      : (formatRangeRef.current ?? lastRangeRef.current);
    if (!r) return false;
    const editor = editorForNode(r.commonAncestorContainer) ?? editorForNode(r.startContainer);
    if (editor) {
      editorRef.current = editor;
      activeEditorBlockIdRef.current = editor.dataset.blockId ?? activeEditorBlockIdRef.current;
      editor.focus({ preventScroll: true });
    }
    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  };

  /**
   * Compute the caret's vertical offset in pixels from the top of the
   * editor content. Returns 0 if no caret is available.
   */
  const getCaretOffsetInEditor = (): number => {
    const el = editorRef.current;
    if (!el) return 0;
    const sel = window.getSelection();
    let range: Range | null = null;
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (el.contains(r.commonAncestorContainer)) range = r.cloneRange();
    }
    if (!range) range = lastRangeRef.current;
    if (!range || !el.contains(range.commonAncestorContainer)) return 0;
    const rects = range.getClientRects();
    let caretTop: number;
    if (rects.length > 0) {
      caretTop = rects[0].top;
    } else {
      // Collapsed range with no rects — insert a temp marker to measure.
      const marker = document.createElement("span");
      marker.textContent = "\u200b";
      const r2 = range.cloneRange();
      r2.collapse(true);
      r2.insertNode(marker);
      caretTop = marker.getBoundingClientRect().top;
      marker.parentNode?.removeChild(marker);
    }
    return caretTop - el.getBoundingClientRect().top;
  };

  const getCaretPromptNodeId = (): string | null => {
    const el = editorRef.current;
    const block = activeBlock;
    if (!el || !block) return null;
    const sel = window.getSelection();
    let container: Node | null = null;
    if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      container = sel.getRangeAt(0).commonAncestorContainer;
    } else if (lastRangeRef.current && el.contains(lastRangeRef.current.commonAncestorContainer)) {
      container = lastRangeRef.current.commonAncestorContainer;
    }
    if (!container) return null;
    const element =
      container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
    const promptNode = element?.closest<HTMLElement>(PROMPT_NODE_SELECTOR);
    // Prefer the explicit data-prompt-node-id stamped by ensurePromptNodeIds —
    // it stays stable across re-renders.
    const stamped = promptNode?.getAttribute("data-prompt-node-id");
    if (stamped) return stamped;
    const nodes = Array.from(el.querySelectorAll<HTMLElement>(PROMPT_NODE_SELECTOR));
    const index = promptNode ? nodes.indexOf(promptNode) : -1;
    return `${block.id}-p-${Math.max(0, index)}`;
  };

  const persistEditor = () => {
    const el = editorRef.current;
    const id = activeEditorBlockIdRef.current ?? activeBlock?.id;
    if (!el || !id) return;
    normalizeBookmarkElementText(el);
    const html = normalizeBookmarkHtml(el.innerHTML);
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, body: html } : b)));
  };

  /**
   * Inline mark toggles (bold / italic / underline). Routed through TipTap's
   * command chain on the active editor. `.focus()` re-anchors the editor's
   * stored selection even though the toolbar button stole DOM focus — this is
   * the ProseMirror-native equivalent of the legacy selection-memory restore,
   * so the useRef memory + `protectToolbarSelection` preventDefault guards on
   * the toolbar still hold (kept intact above) and act as a second safety net.
   */
  const exec = (command: string, _value?: string) => {
    const ed = getActiveTiptap();
    if (!ed) return;
    const chain = ed.chain().focus();
    if (command === "bold") chain.toggleBold().run();
    else if (command === "italic") chain.toggleItalic().run();
    else if (command === "underline") chain.toggleUnderline().run();
    else chain.run();
    saveSelection();
  };

  /**
   * Per-selection inline styling (color / font-family / font-size / highlight).
   * The legacy DOM span-wrap is replaced by faithful ProseMirror marks
   * (TextStyle + Color / FontFamily / FontSize / Highlight) that serialize to
   * the same inline-style HTML, preserving the prompt-mode 1:1 mirror.
   */
  const wrapSelection = (style: Partial<CSSStyleDeclaration>) => {
    const ed = getActiveTiptap();
    if (!ed) return;
    const chain = ed.chain().focus();
    if (style.color) chain.setColor(style.color as string);
    if (style.fontFamily) chain.setFontFamily(style.fontFamily as string);
    if (style.fontSize) chain.setFontSize(style.fontSize as string);
    if (style.backgroundColor) chain.setHighlight({ color: style.backgroundColor as string });
    chain.run();
    saveSelection();
  };

  /** True when the active editor has a non-collapsed selection. ProseMirror
   *  keeps the selection in state even after the toolbar input steals DOM
   *  focus, so this stays correct across toolbar interactions. */
  const hasEditorSelection = (): boolean => {
    const ed = getActiveTiptap();
    return !!ed && !ed.state.selection.empty;
  };
  /** With a selection: wrap it (per-word formatting). With none: change the
   *  canvas default font size. */
  const setFontSize = (px: number) => {
    const safePx = Math.max(10, Math.min(400, px));
    if (hasEditorSelection()) wrapSelection({ fontSize: `${safePx}px` });
    else setSettings((s) => ({ ...s, fontSize: safePx }));
  };
  const applyFormattedFontSize = (formattedSize: string, numericSize: number) => {
    if (hasEditorSelection()) wrapSelection({ fontSize: formattedSize });
    else setSettings((s) => ({ ...s, fontSize: numericSize }));
  };
  const stepFontSize = (event: React.MouseEvent<HTMLButtonElement>, delta: 2 | -2) => {
    event.preventDefault();
    const currentSize = fontSizeInput;
    const cleanSize = parseInt(String(currentSize).replace(/[^0-9]/g, ""), 10);
    const baseSize = Number.isNaN(cleanSize) ? 24 : cleanSize;
    const newSize =
      delta < 0 ? Math.max(10, baseSize - 2) : Math.max(10, Math.min(400, baseSize + 2));
    const formattedSize = `${newSize}px`;
    setFontSizeInput(String(newSize));
    applyFormattedFontSize(formattedSize, newSize);
  };
  const setFontFamily = (family: string) => {
    if (hasEditorSelection()) wrapSelection({ fontFamily: family });
    else setSettings((s) => ({ ...s, fontFamily: family }));
  };
  const applyColor = (color: string) => {
    if (colorScope === "text") {
      setTextColor(color);
      wrapSelection({ color });
    } else if (colorScope === "highlight") {
      setHighlightColor(color);
      wrapSelection({ backgroundColor: color });
    } else {
      setSettings((s) => ({ ...s, bgColor: color }));
    }
  };
  /** Invert the text color of the current selection (or default to black). */
  const invertSelection = () => {
    const ed = getActiveTiptap();
    if (!ed) return;
    const attrs = ed.getAttributes("textStyle");
    const currentColor = (attrs.color as string) || "#000000";
    const inverted = invertHexColor(currentColor);
    ed.chain().focus().setColor(inverted).run();
    setTextColor(inverted);
    saveSelection();
  };

  /** Strip the highlight (background) mark from the current selection. */
  const clearHighlight = () => {
    const ed = getActiveTiptap();
    if (!ed) return;
    ed.chain().focus().unsetHighlight().run();
    saveSelection();
  };

  const dropBookmarkAtCaret = () => {
    const ed = getActiveTiptap();
    if (!ed) return;
    // Insert the bookmark atom node at the current caret via ProseMirror so the
    // document state stays consistent; the BookmarkNode serializes to the exact
    // legacy "[]" span markup the rest of the app already understands.
    ed.chain().focus().insertBookmark().run();
    saveSelection();
    // Clear stale memory so subsequent toolbar actions re-capture fresh coords.
    savedSelectionRef.current = null;
    formatSelectionRef.current = null;
  };

  // ---- Native Electron menu bar relay ----
  // The macOS application menu lives in the Electron main process; each custom
  // item fires an IPC `menu-command` which we map onto the same handlers the
  // in-app toolbar and keyboard shortcuts already use.
  const transformSelection = useCallback(
    (kind: "upper" | "lower" | "capitalize") => {
      const ed = getActiveTiptap();
      if (!ed) return;
      const { from, to } = ed.state.selection;
      if (from === to) return;
      const text = ed.state.doc.textBetween(from, to, "\n");
      const next =
        kind === "upper"
          ? text.toUpperCase()
          : kind === "lower"
            ? text.toLowerCase()
            : text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
      ed.chain().focus().insertContentAt({ from, to }, next).run();
    },
    [getActiveTiptap],
  );

  useElectronMenu({
    preferences: () => setSettingsOpen(true),
    "new-show": () => setNewShowOpen(true),
    save: () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", metaKey: true, ctrlKey: true, bubbles: true }),
      ),
    find: () => {
      if (modeRef.current === "edit") openFind();
    },
    "find-replace": () => {
      if (modeRef.current === "edit") openFind();
    },
    "find-next": () => findStep(1),
    "find-previous": () => findStep(-1),
    "transform-upper": () => transformSelection("upper"),
    "transform-lower": () => transformSelection("lower"),
    "transform-capitalize": () => transformSelection("capitalize"),
    "speech-start": () => readScriptAloud(),
    "speech-stop": () => ttsCancel(),
    "toggle-prompt": () => switchMode(modeRef.current === "edit" ? "prompt" : "edit"),
    "zoom-in": () => setIsEditZoomed(false),
    "zoom-out": () => setIsEditZoomed(true),
    "zoom-reset": () => setIsEditZoomed(false),
    "bookmark-add": () => dropBookmarkAtCaret(),
    "bookmark-next": () =>
      modeRef.current === "edit" ? jumpBookmarkInEditor(1) : jumpBookmark(1),
    "bookmark-previous": () =>
      modeRef.current === "edit" ? jumpBookmarkInEditor(-1) : jumpBookmark(-1),
    "bookmark-clear": () => {
      setBlocks((prev) =>
        prev.map((b) => ({
          ...b,
          body: (b.body ?? "").replace(
            /<span[^>]*data-bookmark(?![^>]*data-bookmark="block-)[^>]*>[\s\S]*?<\/span>/g,
            "",
          ),
        })),
      );
      toast.success("All bookmarks cleared");
    },
  });

  // ---- Native macOS "Format" menu relay ----
  // Apple's typography menu drives TipTap directly: style marks and alignment
  // use built-in extensions; kerning, ligatures and baseline shifts go through
  // the custom AdvancedTypography mark.
  const bumpFontSize = useCallback(
    (delta: number) => {
      const base = parseInt(String(fontSizeInput).replace(/[^0-9]/g, ""), 10);
      const next = Math.max(10, Math.min(400, (Number.isNaN(base) ? 24 : base) + delta));
      setFontSizeInput(String(next));
      applyFormattedFontSize(`${next}px`, next);
    },
    [fontSizeInput, applyFormattedFontSize],
  );

  useElectronFormatMenu(
    useCallback(
      (command: FormatCommand) => {
        const ed = getActiveTiptap();
        const chain = () => ed?.chain().focus();
        switch (command) {
          case "bold":
            chain()?.toggleBold().run();
            break;
          case "italic":
            chain()?.toggleItalic().run();
            break;
          case "underline":
            chain()?.toggleUnderline().run();
            break;
          case "strikethrough":
            chain()?.toggleStrike().run();
            break;
          case "size-bigger":
            bumpFontSize(4);
            break;
          case "size-smaller":
            bumpFontSize(-4);
            break;
          case "size-slightly-bigger":
            bumpFontSize(1);
            break;
          case "size-slightly-smaller":
            bumpFontSize(-1);
            break;
          case "document-bigger":
            setIsEditZoomed(false);
            break;
          case "document-smaller":
            setIsEditZoomed(true);
            break;
          case "align-left":
            chain()?.setTextAlign("left").run();
            break;
          case "align-center":
            chain()?.setTextAlign("center").run();
            break;
          case "align-justify":
            chain()?.setTextAlign("justify").run();
            break;
          case "align-right":
            chain()?.setTextAlign("right").run();
            break;
          case "direction-ltr":
          case "direction-rtl": {
            const dir = command === "direction-ltr" ? "ltr" : "rtl";
            const el = ed?.view.dom as HTMLElement | undefined;
            if (el) el.setAttribute("dir", dir);
            break;
          }
          case "baseline-default":
            chain()?.unsetSuperscript().unsetSubscript().run();
            ed?.chain().focus().setAdvancedTypography({ baseline: null }).run();
            break;
          case "baseline-superscript":
            chain()?.toggleSuperscript().run();
            break;
          case "baseline-subscript":
            chain()?.toggleSubscript().run();
            break;
          case "baseline-raise":
            chain()?.setAdvancedTypography({ baseline: "raise" }).run();
            break;
          case "baseline-lower":
            chain()?.setAdvancedTypography({ baseline: "lower" }).run();
            break;
          case "ligature-default":
            chain()?.setAdvancedTypography({ ligatures: null }).run();
            break;
          case "ligature-none":
            chain()?.setAdvancedTypography({ ligatures: "none" }).run();
            break;
          case "ligature-all":
            chain()?.setAdvancedTypography({ ligatures: "all" }).run();
            break;
          case "kern-default":
          case "kern-none":
            chain()?.setAdvancedTypography({ letterSpacing: null }).run();
            break;
          case "kern-tighten":
            chain()?.setAdvancedTypography({ letterSpacing: "-0.05em" }).run();
            break;
          case "kern-loosen":
            chain()?.setAdvancedTypography({ letterSpacing: "0.05em" }).run();
            break;
        }
        saveSelection();
      },
      [getActiveTiptap, bumpFontSize, saveSelection],
    ),
  );

  // Edit-mode editor HTML hydration is handled per-block inside <BlockEditor>.

  // Long-press inside editor on touch devices → drop bookmark at touched caret.
  useEffect(() => {
    if (mode !== "edit") return;
    const el = editorRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0,
      startY = 0;
    const cancel = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return cancel();
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      cancel();
      timer = setTimeout(() => {
        // Place caret at touch point, then drop bookmark there.
        const doc = document as Document & {
          caretPositionFromPoint?: (
            x: number,
            y: number,
          ) => { offsetNode: Node; offset: number } | null;
          caretRangeFromPoint?: (x: number, y: number) => Range | null;
        };
        let range: Range | null = null;
        if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(startX, startY);
        else if (doc.caretPositionFromPoint) {
          const pos = doc.caretPositionFromPoint(startX, startY);
          if (pos) {
            range = document.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
          }
        }
        if (range && el.contains(range.commonAncestorContainer)) {
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          lastRangeRef.current = range.cloneRange();
          dropBookmarkAtCaret();
          if (navigator.vibrate) navigator.vibrate(40);
        }
      }, 600);
    };
    const onMove = (e: TouchEvent) => {
      if (!timer) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - startX) > 8 || Math.abs(t.clientY - startY) > 8) cancel();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", cancel);
    el.addEventListener("touchcancel", cancel);
    return () => {
      cancel();
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", cancel);
      el.removeEventListener("touchcancel", cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activeBlock?.id]);

  // Keyboard
  useEffect(() => {
    if (displayOnly) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const bookmarkDir: 1 | -1 | null =
        e.key === "]" || e.code === "BracketRight"
          ? 1
          : e.key === "[" || e.code === "BracketLeft"
            ? -1
            : null;
      const target = e.target as HTMLElement | null;
      const inEditor =
        !!(
          target &&
          (target.closest?.("[data-block-editor]") || textRef.current?.contains(target))
        ) &&
        (target?.isContentEditable ?? false);
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          (target.isContentEditable && !inEditor));

      if (!inField && !inEditor && (e.key === "e" || e.key === "E") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        switchMode(modeRef.current === "edit" ? "prompt" : "edit");
        return;
      }
      // Cmd/Ctrl + Enter — toggle Edit ↔ Prompt; on entering Prompt, hand off
      // the current text-cursor position so the canvas opens at the same line.
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (modeRef.current === "edit") {
          switchMode("prompt");
        } else {
          switchMode("edit");
        }
        return;
      }
      if (e.key === "Escape" && modeRef.current === "prompt") {
        e.preventDefault();
        switchMode("edit");
        return;
      }
      // B — toggle blank (works in prompt mode, host only)
      if (
        !inField &&
        !inEditor &&
        (e.key === "b" || e.key === "B") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        modeRef.current === "prompt" &&
        roleRef.current === "host"
      ) {
        e.preventDefault();
        toggleBlank();
        return;
      }
      // C — toggle Stage Cue PIP visibility in Prompt Mode. Lets the
      // H — toggle the Operator HUD anywhere outside a text field.
      if (
        !inField &&
        !inEditor &&
        (e.key === "h" || e.key === "H") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        setIsHudVisible((v) => !v);
        return;
      }
      // C — toggle Stage Cue PIP visibility in Prompt Mode. Lets the
      // operator instantly hide/restore the reminder if it distracts
      // the talent without leaving prompt mode.
      if (
        !inField &&
        !inEditor &&
        (e.key === "c" || e.key === "C") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        modeRef.current === "prompt"
      ) {
        e.preventDefault();
        setSettings((s) => ({ ...s, pip: { ...s.pip, enabled: !s.pip.enabled } }));
        return;
      }
      // M — cycle the 4-way display toggle in Prompt Mode:
      // Normal -> Mirror -> Flip -> Mirror+Flip -> Normal.
      if (
        !inField &&
        !inEditor &&
        (e.key === "m" || e.key === "M") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        modeRef.current === "prompt"
      ) {
        e.preventDefault();
        setSettings((s) => {
          const step = (s.flipH ? 1 : 0) + (s.flipV ? 2 : 0);
          const next = [
            { flipH: true, flipV: false }, // 0 Normal   -> Mirror
            { flipH: false, flipV: true }, // 1 Mirror   -> Flip
            { flipH: false, flipV: false }, // 2 Flip    -> Normal
            { flipH: false, flipV: false }, // 3 Both    -> Normal
          ][step === 3 ? 3 : step];
          const label = next.flipH && next.flipV
            ? "Mirror + Flip"
            : next.flipH
              ? "Mirror"
              : next.flipV
                ? "Flip"
                : "Normal";
          toast(`Display: ${label}`);
          return { ...s, ...next };
        });
        return;
      }
      // Shift + ArrowDown / ArrowUp — instant jump to the next / previous
      // Cue Marker (bookmark) without touching scroll speed.
      if (
        e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !inField &&
        (e.code === "ArrowDown" || e.code === "ArrowUp")
      ) {
        e.preventDefault();
        const dir: 1 | -1 = e.code === "ArrowDown" ? 1 : -1;
        if (modeRef.current === "edit") jumpBookmarkInEditor(dir);
        else jumpBookmark(dir);
        return;
      }
      // Ctrl+1 / 2 / 3 — speaker colors. Ctrl+I italic. Ctrl+M cue marker.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && modeRef.current === "edit") {
        const speaker: Record<string, string> = {
          "1": "#ffffff",
          "2": "#fde047",
          "3": "#22d3ee",
        };
        const ed = activeId ? tiptapEditorsRef.current.get(activeId) : null;
        if (speaker[e.key]) {
          e.preventDefault();
          const color = speaker[e.key];
          ed?.chain().focus().setColor(color).run();
          setTextColor(color);
          return;
        }
        if ((e.key === "i" || e.key === "I") && !e.shiftKey) {
          e.preventDefault();
          ed?.chain().focus().toggleItalic().run();
          return;
        }
        if ((e.key === "m" || e.key === "M") && !e.shiftKey) {
          e.preventDefault();
          dropBookmarkAtCaret();
          return;
        }
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        if (modeRef.current === "edit") {
          e.preventDefault();
          dropBookmarkAtCaret();
        }
        return;
      }
      // Cmd/Ctrl + F — open Find & Replace (edit mode).
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F") && !e.altKey) {
        if (modeRef.current === "edit") {
          e.preventDefault();
          openFind();
        }
        return;
      }
      // Cmd/Ctrl + G — find next; Shift adds previous.
      if ((e.metaKey || e.ctrlKey) && (e.key === "g" || e.key === "G")) {
        if (modeRef.current === "edit" && findQuery) {
          e.preventDefault();
          findStep(e.shiftKey ? -1 : 1);
        }
        return;
      }
      // Cmd/Ctrl + Shift + N — create a new rundown block (edit mode only)
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "l" || e.key === "L")
      ) {
        e.preventDefault();
        setLanderActive((v) => !v);
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "n" || e.key === "N") &&
        modeRef.current === "edit"
      ) {
        e.preventDefault();
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setBlocks((prev) => [...prev, { id, title: `Block ${prev.length + 1}`, body: "<p></p>" }]);
        setActiveId(id);
        toast.success("New block added");
        return;
      }
      // Cmd/Ctrl + Shift + B — split at cursor when focused inside an editor,
      // otherwise append a new empty block. The TipTap canvas is a
      // contenteditable so browser-native handlers eat the keystroke first;
      // this global listener intercepts it before that happens.
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "b" || e.key === "B") &&
        modeRef.current === "edit"
      ) {
        e.preventDefault();
        const activeEditor = activeId ? tiptapEditorsRef.current.get(activeId) : null;
        if (activeEditor && inEditor && activeId) {
          splitBlockAtCursor(activeId, activeEditor);
        } else {
          const id =
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          setBlocks((prev) => [...prev, { id, title: `Block ${prev.length + 1}`, body: "<p></p>" }]);
          setActiveId(id);
          toast.success("New block added");
        }
        return;
      }
      // Cmd/Ctrl + ] / [ — jump between user bookmarks.
      // Prevent the browser from hijacking these for history Back/Forward.
      if (
        (e.metaKey || e.ctrlKey) &&
        bookmarkDir &&
        !e.altKey &&
        !e.shiftKey &&
        modeRef.current === "edit"
      ) {
        e.preventDefault();
        e.stopPropagation();
        jumpBookmarkInEditor(bookmarkDir);
        return;
      }

      if (roleRef.current !== "host") return;
      if (inField || inEditor) return;

      // Left / Right arrows control smooth scroll speed in prompt mode.
      // (Block jumping is available via the rundown / bookmarks.)
      if (e.code === "ArrowRight") {
        e.preventDefault();
        const now = performance.now();
        const last = lastArrowPressRef.current;
        const interval = now - last.time;
        // Deadzone: swallow encoder ticks arriving faster than the configured
        // minimum interval. Prevents jitter (a wobbly encoder emitting two
        // ticks within a few ms) from ever changing speed.
        if (
          !e.repeat &&
          settingsRef.current.encoderDeadzoneMs > 0 &&
          last.dir === 1 &&
          interval < settingsRef.current.encoderDeadzoneMs
        ) {
          return;
        }
        const burst =
          !e.repeat && last.dir === 1 && interval < settingsRef.current.encoderRepeatThresholdMs;
        const burstStep = clampNum(
          MAX_SPEED * (ENCODER_ASSUMED_TICK_MS / Math.max(1, settingsRef.current.encoderRampMs)),
          ENCODER_MIN_STEP,
          ENCODER_MAX_STEP,
        );
        const step = e.repeat
          ? REPEAT_ACCELERATION_STEP
          : burst
            ? burstStep
            : ACCELERATION_STEP;
        lastArrowPressRef.current = { time: now, dir: 1 };
        // Zero-crossing clamp (neutral brake): while running in reverse,
        // ArrowRight only ever brakes TOWARD zero and stops there. A second
        // press from a standstill is what starts forward motion — the script
        // can never be whipped through zero into the opposite direction.
        speedRef.current =
          speedRef.current < 0
            ? Math.min(0, speedRef.current + step)
            : Math.min(MAX_SPEED, speedRef.current + step);
        setSpeed(Math.round(speedRef.current));
        // Push the new speed to clients immediately so their scroll ramp
        // mirrors the host's — the 100ms polling broadcast is too coarse
        // to reproduce the smooth acceleration curve accurately.
        broadcastNow(getState());
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        const now = performance.now();
        const last = lastArrowPressRef.current;
        const interval = now - last.time;
        if (
          !e.repeat &&
          settingsRef.current.encoderDeadzoneMs > 0 &&
          last.dir === -1 &&
          interval < settingsRef.current.encoderDeadzoneMs
        ) {
          return;
        }
        const burst =
          !e.repeat && last.dir === -1 && interval < settingsRef.current.encoderRepeatThresholdMs;
        const burstStep = clampNum(
          MAX_SPEED * (ENCODER_ASSUMED_TICK_MS / Math.max(1, settingsRef.current.encoderRampMs)),
          ENCODER_MIN_STEP,
          ENCODER_MAX_STEP,
        );
        const step = e.repeat
          ? REPEAT_ACCELERATION_STEP
          : burst
            ? burstStep
            : ACCELERATION_STEP;
        lastArrowPressRef.current = { time: now, dir: -1 };
        // Zero-crossing clamp (neutral brake): moving forward, ArrowLeft is a
        // brake that glides to a dead stop at 0 instead of reversing.
        speedRef.current =
          speedRef.current > 0
            ? Math.max(0, speedRef.current - step)
            : Math.max(-MAX_SPEED, speedRef.current - step);
        setSpeed(Math.round(speedRef.current));
        broadcastNow(getState());
      } else if (e.code === "Space") {
        e.preventDefault();
        // Emergency brake — instantly drop velocity to zero.
        keysRef.current.left = false;
        keysRef.current.right = false;
        speedRef.current = 0;
        setSpeed(0);
        broadcastNow({
          playing: false,
          speed: 0,
          scrollY: scrollYRef.current,
          blank: blankRef.current,
          activeBookmark: null,
          ts: Date.now(),
        });
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        scrollYRef.current = Math.max(0, scrollYRef.current - 80);
        speedRef.current = 0;
        setScrollY(scrollYRef.current);
        broadcastNow({
          playing: false,
          speed: 0,
          scrollY: scrollYRef.current,
          blank: blankRef.current,
          activeBookmark: null,
          tieDyeActive: tieDyeRef.current,
          ts: Date.now(),
        });
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        const text = textRef.current;
        const containerH = containerRef.current?.clientHeight ?? 0;
        const max = text ? Math.max(0, text.scrollHeight - containerH) : Number.POSITIVE_INFINITY;
        scrollYRef.current += 80;
        if (scrollYRef.current > max) scrollYRef.current = max;
        speedRef.current = 0;
        setScrollY(scrollYRef.current);
        broadcastNow({
          playing: false,
          speed: 0,
          scrollY: scrollYRef.current,
          blank: blankRef.current,
          activeBookmark: null,
          tieDyeActive: tieDyeRef.current,
          ts: Date.now(),
        });
      } else if (e.code === "Home") {
        // fn + Left (Mac) — jump to the very top of the script.
        e.preventDefault();
        speedRef.current = 0;
        scrollYRef.current = 0;
        setSpeed(0);
        setScrollY(0);
        broadcastNow({
          playing: false,
          speed: 0,
          scrollY: 0,
          blank: blankRef.current,
          activeBookmark: null,
          tieDyeActive: tieDyeRef.current,
          ts: Date.now(),
        });
      } else if (e.code === "End") {
        // fn + Right (Mac) — jump to the very bottom of the script.
        e.preventDefault();
        const text = textRef.current;
        const containerH = containerRef.current?.clientHeight ?? 0;
        const max = text ? Math.max(0, text.scrollHeight - containerH) : scrollYRef.current;
        speedRef.current = 0;
        scrollYRef.current = max;
        setSpeed(0);
        setScrollY(max);
        broadcastNow({
          playing: false,
          speed: 0,
          scrollY: max,
          blank: blankRef.current,
          activeBookmark: null,
          tieDyeActive: tieDyeRef.current,
          ts: Date.now(),
        });
      }
    };
    const onKeyUp = (_e: KeyboardEvent) => {
      // Arrow keys no longer drive a hold-to-accelerate loop — velocity
      // persists from the discrete keydown nudges until the user changes
      // it (Space brakes to zero, opposite arrow decelerates/reverses).
    };
    // Capture phase so Cmd+Shift+B (and PIP/prompt-mode shortcuts) beat the
    // TipTap contenteditable which would otherwise swallow the keystroke.
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcastNow, blocks, activeBlock?.id, displayOnly, openFind, findStep, findQuery]);

  // Two-finger trackpad / wheel scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let rafPending = false;
    const scheduleBroadcast = () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        broadcastNow({
          playing: false,
          speed: 0,
          scrollY: scrollYRef.current,
          blank: blankRef.current,
          activeBookmark: null,
          ts: Date.now(),
        });
      });
    };
    const onWheel = (e: WheelEvent) => {
      // In edit mode, let the container's native overflow scroll handle wheel
      // events (including two-finger trackpad gestures).
      if (modeRef.current === "edit") return;
      if (roleRef.current !== "host") {
        // Followers may only drive the prompter if the host granted scroll
        // control; otherwise the canvas is locked and we surface the toast.
        if (!selfPermissionsRef.current.scrollControl) {
          e.preventDefault();
          notifyLocked();
          return;
        }
      }
      e.preventDefault();
      speedRef.current = 0;
      keysRef.current.left = false;
      keysRef.current.right = false;
      scrollYRef.current += e.deltaY;
      const text = textRef.current;
      if (text) {
        const containerH = containerRef.current?.clientHeight ?? 0;
        const max = Math.max(0, text.scrollHeight - containerH);
        if (scrollYRef.current < 0) scrollYRef.current = 0;
        if (scrollYRef.current > max) scrollYRef.current = max;
      }
      setScrollY(scrollYRef.current);
      scheduleBroadcast();
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    // Touch scroll (mobile / tablet) — drag-to-scroll, host only
    let touchY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      // Brakes first, always: the instant a finger lands on the glass the
      // software scroll engine must stop so it never fights a manual drag or
      // a native swipe. This runs regardless of mode / role / permissions.
      speedRef.current = 0;
      currentSpeedRef.current = 0;
      smoothedTargetRef.current = 0;
      keysRef.current.left = false;
      keysRef.current.right = false;
      // In edit mode, let native scroll + contentEditable handle touches.
      if (modeRef.current === "edit") return;
      if (roleRef.current !== "host" && !selfPermissionsRef.current.scrollControl) return;
      if (e.touches.length !== 1) return;
      touchY = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      // Edit mode: never intercept. The container scrolls natively (pan-y +
      // -webkit-overflow-scrolling: touch) so swipes feel like the OS.
      if (modeRef.current === "edit") {
        touchY = null;
        return;
      }
      if (roleRef.current !== "host" && !selfPermissionsRef.current.scrollControl) {
        notifyLocked();
        return;
      }
      if (touchY == null) return;
      const y = e.touches[0].clientY;
      const dy = touchY - y; // drag up => scroll down
      touchY = y;
      if (e.cancelable) e.preventDefault();
      scrollYRef.current += dy;
      const text = textRef.current;
      if (text) {
        const containerH = containerRef.current?.clientHeight ?? 0;
        const max = Math.max(0, text.scrollHeight - containerH);
        if (scrollYRef.current < 0) scrollYRef.current = 0;
        if (scrollYRef.current > max) scrollYRef.current = max;
      }
      setScrollY(scrollYRef.current);
      scheduleBroadcast();
    };
    const onTouchEnd = () => {
      touchY = null;
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [broadcastNow, notifyLocked]);

  // Eyeline drag
  const draggingEye = useRef(false);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingEye.current) return;
      const y = Math.max(0.05, Math.min(0.95, e.clientY / window.innerHeight));
      setSettings((s) => ({ ...s, eyelineY: y }));
    };
    const onUp = () => {
      draggingEye.current = false;
    };
    // Touch equivalents — the reading guide must be draggable on phones and
    // tablets, where no mousemove is ever emitted.
    const onTouchMove = (e: TouchEvent) => {
      if (!draggingEye.current) return;
      const t = e.touches[0];
      if (!t) return;
      e.preventDefault();
      const y = Math.max(0.05, Math.min(0.95, t.clientY / window.innerHeight));
      setSettings((s) => ({ ...s, eyelineY: y }));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onUp);
    window.addEventListener("touchcancel", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);
    };
  }, []);

  const triSize = settings.triangleSize;
  const triH = Math.round(triSize * 0.8);
  const promptMarkerSize = Math.max(48, settings.triangleSize, settings.fontSize * 0.5);
  const eyelineY = settings.eyelineY;

  const launchExtended = () => {
    // Auto-host on demand so the operator never has to deal with a PIN modal.
    let activePin = pin;
    if (!activePin) {
      activePin = generatePin();
      setPin(activePin);
      setRole("host");
      setHostLost(false);
    }
    const url = `${window.location.origin}/display?room=${encodeURIComponent(activePin)}`;
    window.open(url, "tp-display", "width=1280,height=720,menubar=no,toolbar=no");
    // Push the current edit-screen state immediately so the popup renders the
    // current script in prompt mode the moment it opens (don't wait for the
    // client's REQUEST_SYNC poll).
    setTimeout(() => {
      try {
        broadcastInitialSync(buildInitialSyncPayload());
        broadcastBlocks({ blocks, activeId, ts: Date.now() });
        broadcastDisplay(buildDisplayPayload());
        broadcastNow(getState());
      } catch {
        /* channel may still be subscribing — client will REQUEST_SYNC */
      }
    }, 250);
  };

  // ---- Script import / Smart Auto-Formatter / .prompt session --------------

  const newBlockId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /** Parse dropped/chosen files and inject them as new script blocks. */
  const importScriptFiles = useCallback(async (files: File[]) => {
    const usable = files.filter((f) => isImportableScriptFile(f) || isPromptFile(f));
    if (!usable.length) {
      toast.error("Unsupported file. Use .docx, .pdf, .rtf, .txt or .prompt");
      return;
    }
    setImporting(true);
    try {
      for (const file of usable) {
        if (isPromptFile(file)) {
          await restorePromptFile(file);
          continue;
        }
        const { title, html } = await parseScriptFile(file);
        const id = newBlockId();
        setBlocks((prev) => [...prev, { id, title, body: html || "<p></p>" }]);
        setActiveId(id);
        toast.success(`Imported "${title}"`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
    // restorePromptFile is stable via useCallback below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ¶ FMT — normalize the active block (or the whole show with no active block). */
  const runSmartFormat = useCallback(() => {
    const targetId = activeId;
    let changed = 0;
    setBlocks((prev) =>
      prev.map((b) => {
        if (targetId && b.id !== targetId) return b;
        const next = normalizeScriptHtml(b.body || "");
        if (next !== b.body) changed++;
        return { ...b, body: next };
      }),
    );
    // Push the cleaned HTML into the live TipTap instance so the canvas and
    // the Yjs document stay in lockstep with the block model.
    requestAnimationFrame(() => {
      for (const [id, ed] of tiptapEditorsRef.current.entries()) {
        if (targetId && id !== targetId) continue;
        const cleaned = normalizeScriptHtml(ed.getHTML());
        if (cleaned !== ed.getHTML()) ed.commands.setContent(cleaned, { emitUpdate: true });
      }
    });
    toast.success(changed ? "Script formatted" : "Script already clean");
  }, [activeId]);

  /** Package the whole workspace as a downloadable .prompt session file. */
  const handleExportPromptFile = useCallback(() => {
    try {
      exportPromptFile(
        buildPromptSession({
          name: blocks[0]?.title || "session",
          blocks,
          activeId,
          settings: settings as unknown as Record<string, unknown>,
          speed: speedRef.current,
          scrollY: scrollYRef.current,
          textColor,
          highlightColor,
          annotations,
        }),
      );
      toast.success("Session exported (.prompt)");
    } catch {
      toast.error("Could not export session");
    }
  }, [blocks, activeId, settings, textColor, highlightColor, annotations]);

  /** Restore a complete workspace from a .prompt file. */
  const applySession = useCallback((session: {
    blocks: ScriptBlock[];
    activeId: string | null;
    settings?: Record<string, unknown>;
    textColor?: string;
    highlightColor?: string;
    annotations?: unknown[];
    scrollY?: number;
  }) => {
    setBlocks(session.blocks);
    setActiveId(session.activeId ?? session.blocks[0]?.id ?? null);
    if (session.settings) {
      setSettings((prev) => ({ ...prev, ...(session.settings as Partial<PrompterSettings>) }));
    }
    if (typeof session.textColor === "string") setTextColor(session.textColor);
    if (typeof session.highlightColor === "string") setHighlightColor(session.highlightColor);
    if (Array.isArray(session.annotations)) setAnnotations(session.annotations as Annotation[]);
    speedRef.current = 0;
    setSpeed(0);
    scrollYRef.current = session.scrollY ?? 0;
    setScrollY(session.scrollY ?? 0);
  }, []);

  const restorePromptFile = useCallback(async (file: File) => {
    applySession(await importPromptFile(file));
    toast.success("Session restored");
  }, [applySession]);

  const toggleBlank = () => {
    // (see FTB overlay below — `blank` doubles as the global Fade To Black)
    setBlank((b) => {
      const next = !b;
      blankRef.current = next;
      broadcastNow({
        playing: speedRef.current !== 0,
        speed: speedRef.current,
        scrollY: scrollYRef.current,
        blank: next,
        activeBookmark: null,
        tieDyeActive: tieDyeRef.current,
        ts: Date.now(),
      });
      return next;
    });
  };

  const toggleTieDye = () => {
    setTieDye((t) => {
      const next = !t;
      tieDyeRef.current = next;
      broadcastNow({
        playing: speedRef.current !== 0,
        speed: speedRef.current,
        scrollY: scrollYRef.current,
        blank: blankRef.current,
        activeBookmark: null,
        tieDyeActive: next,
        ts: Date.now(),
      });
      return next;
    });
  };

  // Touch device detection (for mobile joystick)
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    setIsTouch(touch);
  }, []);

  // Fixed-Width Scaling: observe the scroll container's width and compute
  // the `zoom` factor that fits a CANVAS_WIDTH-px canvas into it. Updates on
  // Pinch-to-zoom on the local (mobile / extended display) glass. Two-finger
  // gestures adjust ONLY the local CSS scale multiplier — never the document,
  // never the master, never a broadcast. preventDefault keeps the browser
  // from page-zooming the whole UI instead.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!(displayOnly || role === "client")) return;
    const el = containerRef.current;
    if (!el) return;
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinchRef.current = { startDist: dist(e.touches), startZoom: playViewZoom };
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchRef.current) return;
      e.preventDefault();
      const { startDist, startZoom } = pinchRef.current;
      if (startDist <= 0) return;
      const next = startZoom * (dist(e.touches) / startDist);
      setPlayViewZoom(Number(Math.min(3, Math.max(0.5, next)).toFixed(2)));
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchRef.current = null;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove as EventListener);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [displayOnly, role, playViewZoom]);

  // ---- Host Viewport Broadcasting -------------------------------------
  // The host captures its exact editor container box on mount and on every
  // resize / orientation change. This is the "screen" remote viewers mirror.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (displayOnly || role !== "host") return;
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (!width || !height) return;
      setHostViewport((prev) =>
        prev && Math.abs(prev.width - width) < 2 && Math.abs(prev.height - height) < 2
          ? prev
          : { width, height },
      );
    };
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [displayOnly, role, mode]);

  // ---- Remote "Monitor" letterbox ------------------------------------
  // A remote viewer (client without edit rights) locks its text container to
  // the host's exact pixel dimensions and scales the whole box to fit its own
  // screen — identical line breaks, automatic letter/pillarboxing.
  const remoteHostViewport =
    !displayOnly &&
    role === "client" &&
    remoteDisplay?.hostViewportW &&
    remoteDisplay?.hostViewportH
      ? { width: remoteDisplay.hostViewportW, height: remoteDisplay.hostViewportH }
      : null;
  const viewerLetterbox = !!remoteHostViewport && !editModeAllowed;
  const viewerLetterboxRef = useRef(false);
  useEffect(() => {
    viewerLetterboxRef.current = viewerLetterbox;
  }, [viewerLetterbox]);
  useEffect(() => {
    if (typeof window === "undefined" || !viewerLetterbox) return;
    const measure = () =>
      setViewerScreen((prev) =>
        Math.abs(prev.w - window.innerWidth) < 2 && Math.abs(prev.h - window.innerHeight) < 2
          ? prev
          : { w: window.innerWidth, h: window.innerHeight },
      );
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [viewerLetterbox]);
  const letterboxScale =
    viewerLetterbox && remoteHostViewport && viewerScreen.w > 0 && viewerScreen.h > 0
      ? Math.min(
          viewerScreen.w / remoteHostViewport.width,
          viewerScreen.h / remoteHostViewport.height,
        )
      : 1;
  const lbBoxW = remoteHostViewport ? remoteHostViewport.width * letterboxScale : 0;
  const lbBoxH = remoteHostViewport ? remoteHostViewport.height * letterboxScale : 0;
  const lbLeft = Math.max(0, (viewerScreen.w - lbBoxW) / 2);
  const lbTop = Math.max(0, (viewerScreen.h - lbBoxH) / 2);

  // Fixed-Width Scaling continued: compute the fit factor. Updates on
  // window resize, sidebar toggles, multi-monitor moves, devicePixelRatio
  // changes — anything that resizes the container.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastWidth = -1;
    const compute = () => {
      // Never trust a container that has been stretched by overflowing
      // content — the physical screen is the hard bound on a phone or a
      // secondary display.
      // EXCEPT in viewer-letterbox mode: there the container is deliberately
      // pinned to the HOST's pixel width and scaled as a whole, so the local
      // screen width must not clamp it (that would re-wrap the text).
      const w = viewerLetterboxRef.current
        ? el.clientWidth || window.innerWidth
        : Math.min(el.clientWidth || window.innerWidth, window.innerWidth);
      // Feedback-loop guard: a scale change alters canvas height, which can
      // add/remove a scrollbar, which resizes the container again. Ignore
      // sub-pixel churn and identical widths so the loop can never oscillate
      // (the mobile "flashing" bug).
      if (Math.abs(w - lastWidth) < 2) return;
      lastWidth = w;
      let s = w / CANVAS_WIDTH;
      // Slave / extended-display and any narrow screen scales the master
      // layout DOWN to fit. It must never scale up, or the fixed master
      // canvas overflows and the layout "blows up".
      if (displayOnly || w < CANVAS_WIDTH) s = Math.min(s, 1);
      const next = s > 0 ? s : 1;
      setCanvasScale((prev) => (Math.abs(prev - next) < 0.002 ? prev : next));
    };
    // Debounced entry point — resize storms collapse into one measurement.
    const update = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(compute);
      }, 300);
    };
    compute();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      if (timer) clearTimeout(timer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [displayOnly, viewerLetterbox]);

  /**
   * Final transform scale applied to `.mobile-scale-wrapper`. This is the ONLY
   * place zoom is expressed: the master canvas keeps its rigid pixel width, so
   * the phone / extended display reproduces the desktop's exact line breaks,
   * just painted smaller. Never touches font-size, em/rem or the canvas width.
   */
  const totalCanvasScale =
    canvasScale *
    // LOCAL-ONLY viewer multiplier (slider + pinch). Never broadcast.
    // Letterboxed viewers are a strict screenshare: no local zoom deviation.
    (!viewerLetterbox && (displayOnly || role === "client") ? playViewZoom : 1);
  /**
   * Mobile Edit Mode is FLUID. The rigid 1920px master canvas + transform
   * scale math exists purely so Prompt Mode mirrors line breaks 1:1 across
   * screens; leaking it into Edit Mode on a phone breaks TipTap focus and
   * makes the viewport jump while typing. Edit Mode on <768px therefore uses
   * width:100% / transform:none / normal wrapping.
   */
  // Prompt Mode on the same phone must use the SAME fluid layout, otherwise
  // the % margins resolve against 1920px and jump between modes.
  // Remote Play Along participants on a phone must KEEP the rigid master
  // canvas + transform-scale wrapper, otherwise their line breaks drift from
  // the host's and the text renders at desktop size (unreadable). Only the
  // local operator's own phone gets the fluid editing layout.
  const fluidMobileEdit = isMobile && !displayOnly && role !== "client";

  // ---- On-screen keyboard preference ----
  // `inputmode="none"` keeps the field focusable/selectable but tells mobile
  // browsers not to raise the virtual keyboard. The ⌨ button flips it back on
  // demand for the current editing burst.
  const [keyboardSummoned, setKeyboardSummoned] = useState(false);
  useEffect(() => {
    if (settings.autoKeyboard) setKeyboardSummoned(false);
  }, [settings.autoKeyboard]);
  useEffect(() => {
    const suppress = !settings.autoKeyboard && !keyboardSummoned;
    const apply = () => {
      document.querySelectorAll<HTMLElement>(".tp-editor").forEach((el) => {
        if (suppress) el.setAttribute("inputmode", "none");
        else el.removeAttribute("inputmode");
      });
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [settings.autoKeyboard, keyboardSummoned, mode]);

  const summonKeyboard = useCallback(() => {
    setKeyboardSummoned(true);
    requestAnimationFrame(() => {
      const el =
        (document.activeElement as HTMLElement | null)?.classList.contains("tp-editor")
          ? (document.activeElement as HTMLElement)
          : document.querySelector<HTMLElement>(".tp-editor");
      el?.removeAttribute("inputmode");
      el?.focus();
    });
  }, []);
  useEffect(() => {
    totalScaleRef.current = totalCanvasScale || 1;
  }, [totalCanvasScale]);

  // The transform wrapper must reserve the SCALED height of the unscaled
  // canvas, otherwise the scroll bounds stay sized for the full 1920px layout.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => setCanvasNaturalHeight(canvas.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [mode, blocks, settings.fontSize, settings.lineHeight, settings.fontFamily]);

  // Track canvas position so the Prompt Mode eyeline markers sit just outside
  // the text canvas, never overlapping the script even when marginH is 0.
  useEffect(() => {
    const canvas = canvasRef.current;
    const track = markerTrackRef.current;
    const editArrow = editArrowRef.current;
    if (!canvas) return;

    const update = () => {
      const rect = canvas.getBoundingClientRect();
      // Prompt-mode marker track is anchored to the viewport (inset-x-0),
      // not the canvas — the markers must always be visible regardless of
      // canvas margin. Only the edit-mode handle needs canvas-relative
      // positioning below.
      if (editArrow && editArrow.parentNode) {
        // Never let the arrow slide off-screen. When the canvas hugs the
        // viewport edge (marginH low, narrow window), clamp so a portion
        // of the marker is always visible instead of at negative x.
        editArrow.style.left = `${Math.max(4, rect.left - settings.triangleSize - 4)}px`;
      }
    };

    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    window.addEventListener("resize", update);
    update();

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [canvasScale, playViewZoom, mode, settings.showArrow, settings.triangleSize]);

  // Cursor-activity tracker — used to reveal the tiny prompt-mode X only
  // when the operator wakes the trackpad / mouse.
  const [cursorActive, setCursorActive] = useState(false);
  useEffect(() => {
    if (displayOnly || mode !== "prompt") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wake = () => {
      setCursorActive(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setCursorActive(false), 1800);
    };
    window.addEventListener("mousemove", wake);
    window.addEventListener("touchstart", wake);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("touchstart", wake);
    };
  }, [displayOnly, mode]);

  // Flips apply on the extended display window AND on the operator's own
  // Prompt Mode canvas (the `M` 4-way toggle), never in Edit Mode.
  const flipTransform =
    displayOnly || mode === "prompt"
      ? `${settings.flipH ? "scaleX(-1)" : ""} ${settings.flipV ? "scaleY(-1)" : ""}`.trim()
      : "";

  const titleStyle: React.CSSProperties = {
    fontSize: `${Math.max(24, Math.round(settings.fontSize * 0.7))}px`,
    lineHeight: settings.lineHeight,
    fontFamily: settings.fontFamily,
    textAlign: settings.align,
    textTransform: settings.allCaps ? "uppercase" : undefined,
  };
  /* Symmetrical horizontal squeeze in PIXELS, hard-clamped so the H slider can
     never crush the contenteditable track to zero width (the "can't click into
     the editor" bug). Max 30% of the master canvas per side. */
  const canvasSidePadding = Math.min(
    Math.round((settings.marginH / 100) * CANVAS_WIDTH),
    Math.round(CANVAS_WIDTH * 0.3),
  );
  /** Editing-only font reduction. Prompt Mode / display windows always get
   *  the full user font size, regardless of the toggle state. */
  const displayFontSize =
    mode === "edit" && !displayOnly && isEditZoomed
      ? Math.max(8, Math.round(settings.fontSize * EDIT_ZOOM_FACTOR))
      : settings.fontSize;
  const bodyStyle: React.CSSProperties = {
    fontSize: `${displayFontSize}px`,
    lineHeight: settings.lineHeight,
    fontFamily: settings.fontFamily,
    fontWeight: 700,
    textAlign: settings.align,
    textTransform: settings.allCaps ? "uppercase" : undefined,
  };

  const elapsed = Math.max(0, Math.floor((timerNow - timerStart) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  // ---- Run-time calculator (live ETA) ----------------------------------
  // Total words across non-ghosted blocks, recomputed when the script changes.
  const totalWords = useMemo(() => {
    let n = 0;
    for (const b of blocks) {
      if (b.ghosted) continue;
      const text = (b.body || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z]+;/gi, " ");
      n += text.trim().split(/\s+/).filter(Boolean).length;
    }
    return n;
  }, [blocks]);

  // Measure the rendered content height so ETA reflects the real scroll
  // distance at the current speed (px/frame @ ~60fps).
  const [contentHeight, setContentHeight] = useState(0);
  useEffect(() => {
    const measure = () => {
      const el = textRef.current;
      if (el) setContentHeight(el.scrollHeight);
    };
    measure();
    const id = setInterval(measure, 1500);
    return () => clearInterval(id);
  }, [blocks, mode, settings.fontSize, settings.lineHeight]);

  const etaSeconds =
    speed > 0 && contentHeight > 0 ? Math.round(contentHeight / (speed * 60)) : null;

  // ---- Operator HUD feeds ----------------------------------------------
  const hudScriptText = useMemo(
    () =>
      blocks
        .filter((b) => !b.ghosted)
        .map((b) => (b.body || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " "))
        .join(" "),
    [blocks],
  );
  const hudProgress = contentHeight > 0 ? scrollY / Math.max(1, contentHeight) : 0;

  // ---- Autosave & crash recovery (IndexedDB via localforage) ------------
  // localStorage tops out around 5MB, which a long-form show blows past, so
  // the safety net lives in IndexedDB and is written every 5 seconds.
  const recoveryCheckedRef = useRef(false);
  const sessionSnapshotRef = useRef<() => ReturnType<typeof buildPromptSession>>(() =>
    buildPromptSession({
      name: "autosave",
      blocks: [],
      activeId: null,
      settings: {},
      speed: 0,
      scrollY: 0,
      textColor: "#ffffff",
      highlightColor: "#fde047",
    }),
  );
  sessionSnapshotRef.current = () =>
    buildPromptSession({
      name: blocks[0]?.title || "autosave",
      blocks,
      activeId,
      settings: settings as unknown as Record<string, unknown>,
      speed: speedRef.current,
      scrollY: scrollYRef.current,
      textColor,
      highlightColor,
      annotations,
    });

  useEffect(() => {
    if (displayOnly) return;
    let cancelled = false;
    void (async () => {
      const snap = await loadRecoverySnapshot();
      if (cancelled) {
        return;
      }
      recoveryCheckedRef.current = true;
      if (!snap || !snap.blocks?.length || wasRecoveryDismissed(snap.autosavedAt)) return;
      const when = new Date(snap.autosavedAt).toLocaleTimeString();
      toast("Unsaved session recovered", {
        description: `Autosaved at ${when}. Restore it?`,
        duration: 20000,
        action: {
          label: "Restore",
          onClick: () => {
            applySession(snap);
            toast.success("Session recovered");
          },
        },
        cancel: {
          label: "Discard",
          onClick: () => {
            markRecoveryDismissed(snap.autosavedAt);
            void clearRecoverySnapshot();
          },
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [displayOnly, applySession]);

  useEffect(() => {
    if (displayOnly) return;
    const id = setInterval(() => {
      if (!recoveryCheckedRef.current) return;
      void saveRecoverySnapshot(sessionSnapshotRef.current());
    }, 5000);
    return () => clearInterval(id);
  }, [displayOnly]);
  const etaLabel =
    etaSeconds == null
      ? "—"
      : `${Math.floor(etaSeconds / 60)}m ${String(etaSeconds % 60).padStart(2, "0")}s`;

  const showHostUi = !displayOnly && mode === "edit";
  const showSessionModal = !displayOnly && sessionModalOpen;
  const liveLink = role === "client" && pin && !hostLost && lastReceivedAt > 0;
  const playAlongLink = pin
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/play/${encodeURIComponent(pin)}`
    : "";

  return (
    <div
      className="fixed inset-0 overflow-hidden select-none"
      style={{
        backgroundColor:
          mode === "prompt" ? "var(--prompter-bg, #000)" : tieDye ? undefined : settings.bgColor,
        color: "var(--prompter-fg, #fff)",
      }}
    >
      {tieDye && mode === "edit" && <div className="tie-dye-bg fixed inset-0 z-0 pointer-events-none" />}
      <style>{`
        /* Manual bookmarks: visible blue chevron in EDIT mode only. The
           "block-<id>" data-bookmark on each block wrapper is a scroll target,
           not a user-facing mark — hide its chevron so we don't pepper the
           canvas with one before every block. */
        [data-bookmark]:not([data-bookmark^="block-"]) {
          display: inline;
          cursor: pointer;
          color: #4d8bff;
          font-weight: 700;
          transition: color 120ms ease;
        }
        [data-bookmark]:not([data-bookmark^="block-"]):hover {
          color: #ef4444;
        }
        [data-bookmark]:not([data-bookmark^="block-"])::before { content: none; }
        .tp-edit [data-bookmark^="block-"] { display: block; }
        .tp-prompt [data-bookmark]:not([data-bookmark^="block-"]) {
          /* A zero-height inline-block defaults to vertical-align:baseline,
             which inflates the first line box and shifts the script's true top
             down — making it impossible to scroll back to scrollTop = 0 once a
             bookmark sits at the start. Pulling it out of the layout flow
             (absolute + vertical-align:top + line-height:0) means the bookmark
             can never move the top boundary; the root container alone defines
             it. It stays measurable via getBoundingClientRect for navigation. */
          position: absolute;
          display: inline-block;
          width: 0;
          height: 0;
          line-height: 0;
          vertical-align: top;
          overflow: hidden;
          visibility: hidden;
        }
        .tp-prompt [data-bookmark]:not([data-bookmark^="block-"])::before { content: none; }
        /* Block heading label shown above each block when showHeadings is on. */
        .tp-block-heading {
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.45);
          padding: 4px 8px;
          margin: 0 0 0.5em 0;
          border-left: 2px solid rgba(59,130,246,0.7);
          background: rgba(255,255,255,0.04);
          user-select: none;
        }
        .tp-edit, .tp-editor { user-select: text; }
        .tp-editor:focus { outline: none; }
        /* TRS-1 dark theme: the default black caret is invisible on the dark
           canvas. Force a clearly visible blinking caret on every ProseMirror
           editable, and strip any focus outline that could trap focus. */
        .ProseMirror {
          caret-color: #0055ff; /* Tandy Red */
        }
        /* Keep the editable surface on top of any decorative sibling layer
           (annotations, gradients, guides) so clicks always reach the text. */
        .tp-edit .tp-editor,
        .tp-edit [data-block-editor],
        .tp-edit .ProseMirror {
          position: relative;
          z-index: 10;
          pointer-events: auto;
        }
        /* Guaranteed click target: the editable surface always has physical
           height and a text cursor, even when the script is a single empty
           paragraph. */
        .tp-edit .ProseMirror {
          cursor: text;
        }
        .tp-edit .ProseMirror p {
          min-height: 1.2em;
        }
        .tp-edit [data-block-editor]:last-of-type .ProseMirror {
          min-height: 40vh;
          padding-bottom: 20vh;
        }
        .ProseMirror:focus,
        .ProseMirror:focus-visible {
          outline: none;
        }
        /* Remote collaborator cursors (CollaborationCaret) — Google-Docs feel. */
        .collaboration-carets__caret {
          border-left: 1px solid;
          border-right: 1px solid;
          margin-left: -1px;
          margin-right: -1px;
          pointer-events: none;
          position: relative;
          word-break: normal;
        }
        .collaboration-carets__label {
          position: absolute;
          top: -1.4em;
          left: -1px;
          font-size: 11px;
          font-weight: 600;
          line-height: 1;
          white-space: nowrap;
          color: #fff;
          padding: 2px 4px;
          border-radius: 3px 3px 3px 0;
          user-select: none;
          pointer-events: none;
        }
        /* Clean the Glass: never render collaboration carets / labels (or any
         * stray eyeline marker glyphs) over the prompter feed in Prompt Mode. */
        .tp-prompt .collaboration-carets__caret,
        .tp-prompt .collaboration-carets__label,
        .tp-prompt .collaboration-cursor__caret,
        .tp-prompt .collaboration-cursor__label {
          display: none !important;
        }
        /* NUCLEAR OPTION — kill the rogue arrow under the Eyeline Marker.
         * In Prompt Mode, any Yjs collaboration caret, ProseMirror cursor, or
         * stray inline SVG glyph rendered *inside* the prompter text bounds is
         * forcibly hidden. The user's selected Eyeline Marker is a fixed-
         * position sibling OUTSIDE .tp-prompt, so it is never affected. */
        .tp-prompt .ProseMirror-yjs-cursor,
        .tp-prompt .ProseMirror-yjs-selection,
        .tp-prompt .ProseMirror-widget,
        .tp-prompt svg:not([data-annotation-svg]) {
          display: none !important;
        }
        /* Find & Replace highlight — view-layer decorations only, never in HTML. */
        .tp-search-result {
          background: rgba(232, 90, 90, 0.28);
          border-radius: 2px;
          box-shadow: 0 0 0 1px rgba(232, 90, 90, 0.35);
        }
        .tp-search-result--active {
          background: rgba(255, 196, 0, 0.55);
          box-shadow: 0 0 0 1px rgba(255, 196, 0, 0.9);
          color: #111 !important;
        }
        /* Flashing pulse on the currently-navigated match. The animation is
         * only enabled while the editor DOM carries .tp-flashing, which we
         * add on Cmd+F navigation and strip the moment the user clicks or
         * types so editing stays visually clean. */
        @keyframes tp-search-pulse {
          0%, 100% {
            background: rgba(255, 196, 0, 0.55);
            box-shadow: 0 0 0 2px rgba(255, 196, 0, 0.9);
          }
          50% {
            background: rgba(232, 90, 90, 0.9);
            box-shadow: 0 0 0 3px rgba(232, 90, 90, 1);
          }
        }
        .tp-flashing .tp-search-result--active {
          animation: tp-search-pulse 0.45s ease-in-out 3;
        }
        /* Strict WYSIWYG line breaks: empty paragraphs (hard returns) MUST
         * render at a real line's height in Edit Mode AND Prompt Mode so
         * two returns in the editor equal two returns on the prompter.
         * Prompt Mode renders block.body HTML directly (no .ProseMirror
         * wrapper), so the rule targets both surfaces explicitly. */
        .ProseMirror p,
        .tp-editor p,
        .tp-prompt p {
          min-height: 1.2em;
        }
        /* Pasted Google Docs / Word copy arrives with huge per-paragraph
           margins. Inline styles are scrubbed on paste; this enforces one
           tight, uniform stack for every paragraph regardless of source. */
        .ProseMirror p,
        .tp-editor p,
        .tp-prompt p {
          margin-top: 0 !important;
          margin-bottom: 0.5em !important;
        }
        .ProseMirror p:empty::before,
        .tp-editor p:empty::before,
        .tp-prompt p:empty::before {
          content: "\\00a0";
          display: inline-block;
          white-space: pre;
          min-height: 1.2em;
        }
        /* Make the text caret clearly visible in edit mode against the
           dark prompter background, and give it a thicker accent color. */
        .tp-edit .tp-editor {
          caret-color: var(--prompter-eyeline, #4d8bff);
        }
        /* Shared master canvas: both Edit Mode and Prompt Mode wrap their
           text in .prompter-canvas so typography, line-height, letter-
           spacing, paragraph margins and the box model are byte-identical.
           The wrapper is a fixed CANVAS_WIDTH px container that is zoom-
           scaled to fit each physical screen, so a line always breaks at
           the same word on every display. */
        .prompter-canvas {
          box-sizing: border-box;
          font-kerning: normal;
          font-variant-ligatures: normal;
          font-variant-numeric: normal;
          font-feature-settings: normal;
          text-rendering: geometricPrecision;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          word-spacing: 0;
          letter-spacing: 0;
          hyphens: none;
          overflow-wrap: break-word;
        }
        /* Explicit shared layout contract applied to BOTH the Edit-mode
           editor container and the Prompt-mode display container. Width,
           padding, font-family, line-height, letter-spacing and word-break
           are locked to identical values on both surfaces so line wrapping
           always occurs on the exact same word. Font size / family / line
           height flow in via the --trs1-* CSS variables set on the wrapper
           by React, keeping a single source of truth. */
        .prompter-canvas-core,
        .prompter-canvas-core .tp-editor,
        .prompter-canvas-core [data-block-editor] {
          font-family: var(--trs1-font-family, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
          font-size: var(--trs1-font-size, 96px);
          line-height: var(--trs1-line-height, 1.4);
          letter-spacing: 0;
          word-break: break-word;
          overflow-wrap: break-word;
          white-space: pre-wrap;
          hyphens: none;
        }
        /* Iron-clad master width: the text container NEVER reflows to the
           device. Any fit-to-screen / viewer zoom is a transform on
           .mobile-scale-wrapper, so wrapping is identical on every screen. */
        .prompter-canvas-core {
          max-width: none !important;
          min-width: 0;
          flex-shrink: 0;
        }
        .prompter-canvas-core .tp-editor,
        .prompter-canvas-core [data-block-editor],
        .prompter-canvas-core .ProseMirror {
          width: 100% !important;
          max-width: none !important;
          flex-shrink: 0;
          box-sizing: border-box;
          line-height: var(--trs1-line-height, 1.4) !important;
          margin-left: auto;
          margin-right: auto;
        }
        .mobile-scale-wrapper {
          will-change: transform;
          overflow: visible;
        }
        /* Unified, immutable typography contract shared byte-for-byte by the
           Edit-mode ProseMirror surface AND the Prompt-mode (+ mirrored
           display) output surface. Every layout-critical text property is
           locked here so lines wrap at the exact same character on both
           surfaces and text never reflows/jumps during the handoff. Size,
           line-height and family flow in via CSS variables set on the shared
           .prompter-canvas wrapper, so both surfaces always read one source. */
        .trs1-core-text {
          font-family: var(--trs1-font-family, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
          font-size: var(--trs1-font-size, 96px);
          line-height: var(--trs1-line-height, 1.4);
          letter-spacing: 0;
          word-break: break-word;
          overflow-wrap: break-word;
          white-space: pre-wrap;
          font-variant-numeric: tabular-nums;
          font-kerning: normal;
          hyphens: none;
        }
        /* Strip any contentEditable chrome that would shift the box model
           between Edit and Prompt. */
        .prompter-canvas .tp-editor,
        .prompter-canvas [data-block-editor] {
          margin: 0;
          padding: 0;
          border: 0;
          outline: 0;
          background: transparent;
          box-sizing: border-box;
        }
        .tp-editor p,
        .tp-editor h1, .tp-editor h2, .tp-editor h3,
        .tp-editor h4, .tp-editor h5, .tp-editor h6,
        .tp-editor blockquote, .tp-editor ul, .tp-editor ol,
        .tp-prompt p,
        .tp-prompt h1, .tp-prompt h2, .tp-prompt h3,
        .tp-prompt h4, .tp-prompt h5, .tp-prompt h6,
        .tp-prompt blockquote, .tp-prompt ul, .tp-prompt ol {
          margin-top: 0 !important;
          margin-bottom: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
          line-height: inherit !important;
        }
        .tp-editor p + p, .tp-prompt p + p { margin-top: 0 !important; }
        /* Descender clipping guard. At broadcast sizes (96px+) a tight
           line-height slices the bottoms off "g/y/p" because the block box
           is shorter than the glyph. Floor every text block at 1.2em and
           never let the box clip its own ink. */
        .tp-editor p, .tp-prompt p, .ProseMirror p,
        .tp-editor h1, .tp-editor h2, .tp-editor h3,
        .tp-editor h4, .tp-editor h5, .tp-editor h6,
        .tp-prompt h1, .tp-prompt h2, .tp-prompt h3,
        .tp-prompt h4, .tp-prompt h5, .tp-prompt h6,
        .ProseMirror h1, .ProseMirror h2, .ProseMirror h3,
        .ProseMirror h4, .ProseMirror h5, .ProseMirror h6,
        .tp-editor li, .tp-prompt li, .ProseMirror li,
        .tp-editor blockquote, .tp-prompt blockquote, .ProseMirror blockquote {
          line-height: max(1.2em, calc(var(--trs1-line-height, 1.2) * 1em)) !important;
          overflow: visible !important;
        }
        .ProseMirror, .tp-editor, .tp-prompt {
          overflow: visible !important;
        }
        /* Collapse trailing empty paragraphs on the read-only Prompt surface
         * only. In Edit Mode they MUST keep their box so the operator always
         * has something to click into. */
        .tp-prompt p:empty:last-child {
          display: none !important;
          height: 0 !important;
          min-height: 0 !important;
          margin: 0 !important;
        }
        .tp-editor span, .tp-editor mark,
        .tp-prompt span, .tp-prompt mark {
          vertical-align: baseline;
          line-height: inherit;
        }
        .tp-editor mark, .tp-prompt mark {
          color: inherit;
          border-radius: 0.04em;
        }
        /* Continuous canvas: every rundown block must participate in normal
           document flow so Live mode stacks blocks instead of compressing them. */
        .tp-prompt {
          display: flex;
          flex-direction: column;
          gap: 0.5em;
          align-items: stretch;
        }
        .tp-prompt [data-bookmark^="block-"] { display: block; }
        /* Prompt Mode is the canvas only: block labels and every editor-only
           decoration are excluded without changing the script box model. */
        .tp-prompt .tp-block-heading { display: none !important; }
        /* Prompt Mode runs the LIVE TipTap editor with editable=false: hide the
           caret and any focus ring so it reads as pure glass, and hard-lock the
           master canvas width so mobile scaling can never crush line breaks. */
        .tp-prompt .ProseMirror {
          caret-color: transparent !important;
          outline: none !important;
          cursor: default;
          min-height: 0 !important;
          padding-bottom: 0 !important;
        }
        .tp-prompt > div:not([data-annotation-layer]) {
          position: relative;
          height: auto;
          min-height: 1.5em;
          flex: 0 0 auto;
          margin: 0;
          padding: 0;
          border: 0;
        }
        .tie-dye-bg {
          background:
            radial-gradient(circle at 20% 20%, #ff00cc 0%, transparent 40%),
            radial-gradient(circle at 80% 30%, #00e5ff 0%, transparent 45%),
            radial-gradient(circle at 30% 80%, #ffea00 0%, transparent 40%),
            radial-gradient(circle at 75% 75%, #7c00ff 0%, transparent 45%),
            radial-gradient(circle at 50% 50%, #ff5500 0%, transparent 50%),
            #ff00aa;
          background-size: 220% 220%, 220% 220%, 220% 220%, 220% 220%, 220% 220%, 100% 100%;
          animation: tieDyeShift 8s ease-in-out infinite;
          filter: blur(2px) saturate(1.4);
        }
        @keyframes tieDyeShift {
          0%   { background-position:   0% 0%, 100% 0%,   0% 100%, 100% 100%, 50% 50%, 0 0; }
          25%  { background-position: 100% 50%,  50% 100%, 50%   0%,   0% 50%, 30% 70%, 0 0; }
          50%  { background-position: 100% 100%, 0% 100%, 100%  50%,  50%  0%, 70% 30%, 0 0; }
          75%  { background-position:  50%   0%, 0%  50%,   0%   0%,  50% 100%, 20% 80%, 0 0; }
          100% { background-position:   0% 0%, 100% 0%,   0% 100%, 100% 100%, 50% 50%, 0 0; }
        }
      `}</style>

      {!displayOnly && mode === "edit" && (
        <Rundown
          blocks={blocks}
          setBlocks={setBlocks}
          activeId={activeId}
          setActiveId={setActiveId}
          fontFamily={settings.fontFamily}
          allCaps={settings.allCaps}
          hostMode={mode}
          onBackupModeChange={setBackupModeLocked}
          onScrollToBlock={(id, offsetRatio) => {
            setActiveId(id);
            if (modeRef.current !== "edit") setMode("edit");
            requestEditScrollTo(id, offsetRatio);
          }}
          onJumpToBlock={(id) => {
            setActiveId(id);
            if (modeRef.current !== "edit") setMode("edit");
            requestEditScrollTo(id);
          }}
          userRole={role}
          peers={peers}
          selfUserId={user?.id ?? null}
          selfUserName={user?.name ?? "Player"}
          onSetEditingBlock={setEditingBlock}
          onSendProposeChange={sendProposeChange}
          registerAckListener={registerAckListener}
          pipConfig={{
            enabled: settings.pip.enabled,
            text: settings.pip.text,
            opacity: settings.pip.opacity ?? 1,
            scale: settings.pip.scale ?? 1,
            fontSize: settings.pip.fontSize ?? 22,
          }}
          onPipChange={(patch) =>
            setSettings((s) => ({ ...s, pip: { ...s.pip, ...patch } }))
          }
        />
      )}
      {showHostUi && (
        <>
          {/* Restore button when toolbar hidden */}
          {toolbarHidden && (
            <Button
              size="sm"
              variant="secondary"
              className="fixed right-3 top-3 z-50 h-8 w-8 rounded-sm border border-[#2a2a2a] bg-[#141414] p-0 text-[#888] shadow-none hover:bg-[#1f1f1f] hover:text-[#e5e5e5]"
              onClick={() => setToolbarHidden(false)}
              title="Show toolbar"
            >
              <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
            </Button>
          )}

          {/* Unified Edit Mode toolbar — pro broadcast aesthetic */}
          {/* Two-tier Edit Mode toolbar — Row 1: system & execution,
              Row 2: formatting & tools. Strict flex columns; no floats. */}
          <div
            ref={toolbarRef}
            className={`fixed left-0 right-0 top-0 z-40 flex w-full flex-col border-b border-[#333] bg-[#141414]/95 text-xs text-[#e5e5e5] backdrop-blur transition-transform duration-300 ${
              toolbarHidden ? "-translate-y-[150%]" : ""
            }`}
          >
            {/* ---- ROW 1 — System & Execution ---- */}
            <div className="flex w-full flex-row flex-nowrap items-center justify-between gap-4 overflow-x-auto whitespace-nowrap border-b border-[#222] px-4 py-2 [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-x-visible md:whitespace-normal">
              {/* LEFT — File actions */}
              <div className="flex shrink-0 items-center gap-2">
            {/* Far-left File Actions cluster — physically isolated from the
                Prompt Mode button (which is pinned far-right via ml-auto) so
                the destructive New Show / Save / Open group can never be
                confused with going live. */}
            {!displayOnly && role === "host" && (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="relative z-50 h-9 min-w-[92px] touch-manipulation rounded-sm border border-[#0055ff]/40 bg-transparent px-3 text-[10px] font-medium uppercase tracking-wider text-[#4d8bff] shadow-none hover:bg-[#0055ff]/20 md:h-7 md:min-w-0 md:px-2.5"
                  onClick={() => setNewShowOpen(true)}
                  onPointerDown={(e) => e.stopPropagation()}
                  title="Wipe the current script and start a fresh show"
                >
                  <RotateCcw className="mr-1 h-3 w-3" strokeWidth={1.5} /> New Show
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 rounded-sm border border-[#2a2a2a] bg-transparent px-2.5 text-[10px] font-medium uppercase tracking-wider text-[#bbb] shadow-none hover:bg-[#1f1f1f] hover:text-white"
                  onClick={() => {
                    const w = window as unknown as { promptinc?: { openDialog?: () => void } };
                    if (w.promptinc?.openDialog) w.promptinc.openDialog();
                    else window.dispatchEvent(new Event("promptinc:open-file"));
                  }}
                  title="Open a script (⌘O)"
                >
                  <FolderOpen className="mr-1 h-3.5 w-3.5" strokeWidth={1.5} /> Open
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 rounded-sm border border-[#2a2a2a] bg-transparent px-2.5 text-[10px] font-medium uppercase tracking-wider text-[#bbb] shadow-none hover:bg-[#1f1f1f] hover:text-white"
                  onClick={() =>
                    window.dispatchEvent(
                      new KeyboardEvent("keydown", {
                        key: "s",
                        metaKey: true,
                        ctrlKey: true,
                        bubbles: true,
                      }),
                    )
                  }
                  title="Save script to disk (⌘S)"
                >
                  <Save className="mr-1 h-3.5 w-3.5" strokeWidth={1.5} /> Save
                </Button>
              </div>
            )}
              </div>
              {/* CENTER — Cloud + Play Room status */}
              <div className="flex shrink-0 items-center justify-center gap-4 md:min-w-0 md:flex-1 md:shrink md:overflow-hidden">
            {/* Group: session / sync */}
            <div className="flex items-center gap-1.5 px-0.5 text-[11px]">
              {!pin ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 rounded-sm border border-[#2a2a2a] bg-transparent px-2.5 text-[10px] font-medium uppercase tracking-wider text-[#bbb] shadow-none hover:bg-[#1f1f1f] hover:text-white"
                    onClick={() => setSessionModalOpen(true)}
                    title="Open the session sharing dialog"
                  >
                    <Radio className="mr-1 h-3 w-3" strokeWidth={1.5} /> Connect to Cloud
                  </Button>
                  {/* Cloud connection status pill — visible even before a
                      session exists so operators know the app is standalone. */}
                  <span
                    className="inline-flex h-6 items-center gap-1 rounded-sm border border-[#2a2a2a] bg-[#0c0c0c] px-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#666]"
                    title="Not connected to a cloud session. Click Connect to Cloud or Play Room to start syncing."
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-[#555]" />
                    Disconnected
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 rounded-sm border border-[#0055ff]/40 bg-[#0055ff]/10 px-2.5 text-[10px] font-medium uppercase tracking-wider text-[#4d8bff] shadow-none hover:bg-[#0055ff]/20"
                    onClick={handleCreateTestRoom}
                    title="Generate a room PIN + Play Along Room link and copy it for instant collaboration"
                  >
                    <Radio className="mr-1 h-3 w-3" strokeWidth={1.5} /> Play Room
                  </Button>
                </>
              ) : (
                <>
                  {role === "client" ? (
                    liveLink ? (
                      <Wifi className="h-3.5 w-3.5 text-[#5a8a5c]" strokeWidth={1.5} />
                    ) : (
                      <WifiOff className="h-3.5 w-3.5 text-[#0055ff]" strokeWidth={1.5} />
                    )
                  ) : (
                    <Wifi
                      className={`h-3.5 w-3.5 ${connected ? "text-[#5a8a5c]" : "text-[#555]"}`}
                      strokeWidth={1.5}
                    />
                  )}
                  {/* Live connection status pill with automatic retry. The
                      underlying sync hook already backs off and reconnects on
                      its own; this button gives the operator a manual kick
                      when a stubborn drop needs an immediate reattempt. */}
                  {(() => {
                    const state: "connected" | "connecting" =
                      role === "client"
                        ? liveLink
                          ? "connected"
                          : "connecting"
                        : connected
                          ? "connected"
                          : "connecting";
                    const label = state === "connected" ? "Connected" : "Connecting…";
                    const dot = state === "connected" ? "bg-[#5a8a5c]" : "bg-[#e5b83b] animate-pulse";
                    const tone =
                      state === "connected"
                        ? "border-[#2a2a2a] bg-[#0c0c0c] text-[#9ee5a1]"
                        : "border-[#3a2d0a] bg-[#1a1405] text-[#e5b83b]";
                    return (
                      <Popover open={connectionMenuOpen} onOpenChange={setConnectionMenuOpen}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className={`inline-flex h-6 items-center gap-1 rounded-sm border px-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] ${tone}`}
                            title={
                              state === "connected"
                                ? "Cloud session is live — click for session options."
                                : "Reconnecting to the cloud session — click for session options."
                            }
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                            {label}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="center"
                          className="w-60 rounded-sm border-[#2a2a2a] bg-[#0c0c0c] p-2 text-[#e5e5e5]"
                        >
                          <div className="px-1 pb-2 text-[9px] uppercase tracking-[0.2em] text-[#666]">
                            Session {pin}
                          </div>
                          {state === "connecting" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={retryConnection}
                              className="mb-1 h-8 w-full justify-start rounded-sm px-2 text-[10px] uppercase tracking-[0.16em] text-[#e5b83b] hover:bg-[#252525]"
                            >
                              <RefreshCw className="mr-1.5 h-3 w-3" strokeWidth={1.75} />
                              Retry connection
                            </Button>
                          )}
                          <Button
                            size="sm"
                            onClick={handleLeaveSession}
                            className="h-8 w-full justify-start rounded-sm border border-[#0055FF]/50 bg-[#0055FF]/10 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4d8bff] shadow-none hover:bg-[#0055FF]/30"
                          >
                            Disconnect from Session
                          </Button>
                          <p className="mt-2 px-1 text-[9px] leading-relaxed text-[#666]">
                            Safely drops back to solo mode. Your script stays intact.
                          </p>
                        </PopoverContent>
                      </Popover>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={copyPin}
                    className="flex items-center gap-1 rounded-sm border border-[#2a2a2a] bg-[#0c0c0c] px-1.5 py-0.5 font-mono text-[10px] tracking-[0.25em] hover:bg-[#1f1f1f]"
                    title="Click to copy session PIN"
                  >
                    {pin}
                    <Copy className="h-2.5 w-2.5 opacity-50" strokeWidth={1.5} />
                    {pinCopied && <span className="text-[#5a8a5c]">✓</span>}
                  </button>
                  {/* MANAGE CREW — lives right next to the room code so the
                      operator never hunts for permissions mid-show. */}
                  {role === "host" && (
                    <Popover open={crewMenuOpen} onOpenChange={setCrewMenuOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="relative inline-flex h-6 items-center gap-1 rounded-sm border border-[#0055ff]/50 bg-[#0055ff]/10 px-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#4d8bff] hover:bg-[#0055ff]/25"
                          title="Manage crew — roles, scroll handoff, admissions"
                        >
                          <Users className="h-3 w-3" strokeWidth={1.75} />
                          <span className="hidden sm:inline">Manage Crew</span>
                          {pendingAdmissions.length > 0 && (
                            <span className="ml-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#0055FF] px-1 text-[8px] font-bold text-white">
                              {pendingAdmissions.length}
                            </span>
                          )}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="center"
                        className="w-80 rounded-sm border-[#2a2a2a] bg-[#0c0c0c] p-2 text-[#e5e5e5]"
                      >
                        <div className="flex items-center justify-between px-1 pb-2">
                          <span className="text-[9px] uppercase tracking-[0.2em] text-[#666]">
                            Crew · {pin}
                          </span>
                          <button
                            type="button"
                            onClick={() => passScrollControl(null)}
                            className="rounded-sm border border-[#2a2a2a] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.16em] text-[#bbb] hover:bg-[#1f1f1f]"
                            title="Take scroll control back"
                          >
                            {scrollDriverId ? "Take Back Scroll" : "You Drive"}
                          </button>
                        </div>
                        <div className="max-h-64 space-y-2 overflow-y-auto">
                          {(() => {
                            const crew = peers.filter(
                              (p) =>
                                p.role !== "host" &&
                                p.user_id !== user?.id &&
                                !kickedUserIds.includes(p.user_id),
                            );
                            if (crew.length === 0)
                              return (
                                <p className="px-1 py-3 text-[10px] uppercase tracking-[0.14em] text-[#555]">
                                  No crew connected yet.
                                </p>
                              );
                            return crew.map((p) => {
                              const perm = permissions[p.user_id] ?? DEFAULT_OBSERVE_PERMISSIONS;
                              const isEditor = !!perm.editInEditMode;
                              return (
                                <div
                                  key={p.user_id}
                                  className="rounded-sm border border-[#1f1f1f] bg-[#101010] p-2"
                                >
                                  <div className="mb-1.5 flex items-center gap-2">
                                    <span
                                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                                      style={{ backgroundColor: p.color }}
                                    />
                                    <span className="min-w-0 flex-1 truncate text-[11px] text-white">
                                      {p.name}
                                    </span>
                                    <span className="text-[9px] uppercase tracking-[0.16em] text-[#666]">
                                      {isEditor ? "Editor" : "Viewer"}
                                    </span>
                                    <Switch
                                      checked={isEditor}
                                      onCheckedChange={(v) =>
                                        setCrewRole(p.user_id, v ? "editor" : "viewer")
                                      }
                                      title="Toggle Viewer / Editor"
                                    />
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => passScrollControl(p.user_id, p.name)}
                                      className={`flex-1 rounded-sm border px-2 py-1 text-[9px] uppercase tracking-[0.16em] ${
                                        scrollDriverId === p.user_id
                                          ? "border-[#5a8a5c] bg-[#5a8a5c]/20 text-[#8fce91]"
                                          : "border-[#2a2a2a] bg-transparent text-[#bbb] hover:bg-[#1f1f1f]"
                                      }`}
                                    >
                                      {scrollDriverId === p.user_id
                                        ? "Driving Scroll"
                                        : "Pass Scroll Control"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleKickUser(p.user_id, p.name)}
                                      className="rounded-sm border border-[#0055FF]/50 bg-[#0055FF]/10 px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-[#4d8bff] hover:bg-[#0055FF]/30"
                                    >
                                      Kick
                                    </button>
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setCrewMenuOpen(false);
                            setParticipantsOpen(true);
                          }}
                          className="mt-2 h-8 w-full justify-center rounded-sm border border-[#2a2a2a] text-[10px] uppercase tracking-[0.16em] text-[#bbb] hover:bg-[#252525]"
                        >
                          Open Command Center
                          {pendingAdmissions.length > 0 && ` (${pendingAdmissions.length} waiting)`}
                        </Button>
                      </PopoverContent>
                    </Popover>
                  )}
                  <span
                    className={`hidden text-[9px] font-semibold uppercase tracking-[0.2em] sm:inline ${role === "host" ? "text-[#4d8bff]" : "text-[#888]"}`}
                  >
                    {role === "host" ? "HOST" : "PLAY ALONG ROOM"}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 rounded-sm px-1.5 text-[10px] uppercase tracking-wider text-[#666] hover:bg-[#252525] hover:text-white"
                    onClick={handleLeaveSession}
                    title="Leave session — back to solo mode"
                  >
                    Leave
                  </Button>
                </>
              )}
              <span className="hidden w-10 text-right font-mono text-[10px] tabular-nums text-[#666] md:inline">
                {speed}
              </span>
            </div>
              </div>
              {/* RIGHT — Editor zoom + Prompt Mode */}
              <div className="flex shrink-0 items-center gap-4">
            {/* Edit-only visual zoom. CSS-only — scales the canvas wrapper via
                the `zoom` prop already applied above. Does not touch document
                nodes and is ignored the moment mode flips to Prompt. */}
              <Button
                size="sm"
                variant="secondary"
                className="mx-2 h-8 rounded-sm border-2 border-[#0055ff] bg-[#0055ff] px-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white shadow-[0_0_0_2px_rgba(0,85,255,0.15)] hover:bg-[#1a6bff]"
                onClick={() => switchMode("prompt")}
                title="Enter clean Prompt Mode (E)"
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" strokeWidth={2} /> Prompt Mode
              </Button>
              <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 rounded-sm p-0 text-[#888] hover:bg-[#252525] hover:text-white"
                    title="Settings (⌘,)"
                  >
                    <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 max-h-[80vh] overflow-y-auto rounded-sm border-[#2a2a2a] bg-[#141414] p-3 text-[#e5e5e5] shadow-xl">
                  <SettingsPanel settings={settings} setSettings={setSettings} />
                </PopoverContent>
              </Popover>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 rounded-sm p-0 text-[#666] hover:bg-[#252525] hover:text-white"
                onClick={() => setToolbarHidden(true)}
                title="Hide toolbar"
              >
                <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
              </div>
            </div>
            {/* ---- ROW 2 — Formatting & Tools ---- */}
            <div className="flex w-full flex-row flex-nowrap items-center justify-start gap-4 overflow-x-auto whitespace-nowrap px-4 py-2 [&::-webkit-scrollbar]:hidden md:overflow-x-visible md:whitespace-normal">
            {role === "host" && (
              <>
                {/* Mobile: collapse format controls into a popover */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex h-8 shrink-0 items-center gap-1 rounded-sm px-2 text-[10px] font-medium uppercase tracking-wider text-[#bbb] hover:bg-[#252525] hover:text-white md:hidden"
                      onMouseDown={protectToolbarSelection}
                      title="Format"
                    >
                      <Sliders className="h-3.5 w-3.5" strokeWidth={1.5} /> Aa
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-72 rounded-sm border-[#2a2a2a] bg-[#141414] p-3 text-[#e5e5e5] shadow-xl"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 rounded-sm p-0 text-[#bbb] hover:bg-[#252525] hover:text-white"
                          onMouseDown={protectToolbarSelection}
                          onClick={() => exec("bold")}
                          title="Bold"
                        >
                          <Bold className="h-4 w-4" strokeWidth={1.5} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 rounded-sm p-0 text-[#bbb] hover:bg-[#252525] hover:text-white"
                          onMouseDown={protectToolbarSelection}
                          onClick={() => exec("italic")}
                          title="Italic"
                        >
                          <Italic className="h-4 w-4" strokeWidth={1.5} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 rounded-sm p-0 text-[#bbb] hover:bg-[#252525] hover:text-white"
                          onMouseDown={protectToolbarSelection}
                          onClick={() => exec("underline")}
                          title="Underline"
                        >
                          <Underline className="h-4 w-4" strokeWidth={1.5} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`h-8 w-8 rounded-sm p-0 hover:bg-[#252525] hover:text-white ${settings.allCaps ? "bg-[#252525] text-[#4d8bff]" : "text-[#bbb]"}`}
                          onMouseDown={protectToolbarSelection}
                          onClick={() => setSettings((s) => ({ ...s, allCaps: !s.allCaps }))}
                          title="ALL CAPS"
                        >
                          <CaseUpper className="h-4 w-4" strokeWidth={1.5} />
                        </Button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Type className="h-3.5 w-3.5 text-[#666]" strokeWidth={1.5} />
                        <div className="flex items-center gap-0.5 rounded-sm border border-[#2a2a2a] bg-[#0c0c0c]">
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              saveSelectionForToolbar();
                            }}
                            onClick={(e) => stepFontSize(e, -2)}
                            className="flex h-8 w-7 items-center justify-center text-[#bbb] hover:bg-[#252525] hover:text-white"
                            title="Decrease font size"
                          >
                            <MinusIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                          <Input
                            type="number"
                            min={10}
                            max={400}
                            step={1}
                            value={fontSizeInput}
                            onPointerDown={saveSelectionForToolbar}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setFontSizeInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const v = parseInt(fontSizeInput, 10);
                                if (v > 0) setFontSize(v);
                              }
                            }}
                            className="no-spin h-8 w-12 rounded-none border-0 bg-transparent px-1 text-center text-xs text-[#e5e5e5] focus-visible:ring-0"
                            title="Font size px"
                          />
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              saveSelectionForToolbar();
                            }}
                            onClick={(e) => stepFontSize(e, 2)}
                            className="flex h-8 w-7 items-center justify-center text-[#bbb] hover:bg-[#252525] hover:text-white"
                            title="Increase font size"
                          >
                            <PlusIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 rounded-sm px-2 text-[10px] font-medium uppercase tracking-wider text-[#888] hover:bg-[#252525] hover:text-white"
                          onMouseDown={protectToolbarSelection}
                          onClick={() => {
                            const v = parseInt(fontSizeInput, 10);
                            if (v > 0) setFontSize(v);
                          }}
                        >
                          Set
                        </Button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Type className="h-3.5 w-3.5 text-[#666]" strokeWidth={1.5} />
                        <select
                          onPointerDown={saveSelectionForToolbar}
                          onMouseDown={saveSelectionForToolbar}
                          value=""
                          onChange={(e) => {
                            if (e.target.value) setFontFamily(e.target.value);
                            e.currentTarget.value = "";
                          }}
                          className="h-8 flex-1 rounded-sm border border-[#2a2a2a] bg-[#0c0c0c] px-1.5 text-[11px] text-[#e5e5e5]"
                          title="Font family"
                        >
                          <option value="">Font family…</option>
                          {FONT_FAMILIES.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="flex items-center gap-0.5 rounded-sm border border-[#2a2a2a] bg-[#0c0c0c] p-0.5 text-[10px]">
                          {(["text", "highlight", "background"] as const).map((scope) => (
                            <button
                              key={scope}
                              type="button"
                              onMouseDown={protectToolbarSelection}
                              onClick={() => setColorScope(scope)}
                              className={`px-2 py-1 rounded-sm uppercase tracking-wider transition-colors ${
                                colorScope === scope
                                  ? "bg-[#252525] text-white"
                                  : "text-[#666] hover:text-[#bbb]"
                              }`}
                            >
                              {scope === "text" ? "Txt" : scope === "highlight" ? "Hl" : "Bg"}
                            </button>
                          ))}
                        </div>
                        <input
                          type="color"
                          value={
                            colorScope === "text"
                              ? textColor
                              : colorScope === "highlight"
                                ? highlightColor
                                : settings.bgColor
                          }
                          onPointerDown={saveSelectionForToolbar}
                          onMouseDown={saveSelectionForToolbar}
                          onChange={(e) => {
                            const c = e.target.value;
                            if (colorScope === "text") setTextColor(c);
                            else if (colorScope === "highlight") setHighlightColor(c);
                            else setSettings((s) => ({ ...s, bgColor: c }));
                          }}
                          onBlur={(e) => applyColor(e.target.value)}
                          className="h-8 w-8 cursor-pointer rounded-sm border border-[#2a2a2a] bg-transparent"
                          title={`${colorScope} color`}
                        />
                        <button
                          type="button"
                          onMouseDown={protectToolbarSelection}
                          onClick={invertSelection}
                          className="px-2 py-1 rounded-sm uppercase tracking-wider transition-colors text-[#666] hover:text-[#bbb] hover:bg-[#252525] text-[10px]"
                          title="Invert selected text color"
                        >
                          Inv
                        </button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 rounded-sm p-0 text-[#bbb] hover:bg-[#252525] hover:text-white"
                          onMouseDown={protectToolbarSelection}
                          onClick={clearHighlight}
                          title="Clear highlight"
                        >
                          <Highlighter className="h-4 w-4" strokeWidth={1.5} />
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                <div className="hidden items-center gap-0.5 md:flex">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 rounded-sm p-0 text-[#bbb] hover:bg-[#252525] hover:text-white"
                    onMouseDown={protectToolbarSelection}
                    onClick={() => exec("bold")}
                    title="Bold"
                  >
                    <Bold className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 rounded-sm p-0 text-[#bbb] hover:bg-[#252525] hover:text-white"
                    onMouseDown={protectToolbarSelection}
                    onClick={() => exec("italic")}
                    title="Italic"
                  >
                    <Italic className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 rounded-sm p-0 text-[#bbb] hover:bg-[#252525] hover:text-white"
                    onMouseDown={protectToolbarSelection}
                    onClick={() => exec("underline")}
                    title="Underline"
                  >
                    <Underline className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`h-8 w-8 rounded-sm p-0 hover:bg-[#252525] hover:text-white ${settings.allCaps ? "bg-[#252525] text-[#4d8bff]" : "text-[#bbb]"}`}
                    onMouseDown={protectToolbarSelection}
                    onClick={() => setSettings((s) => ({ ...s, allCaps: !s.allCaps }))}
                    title="ALL CAPS"
                  >
                    <CaseUpper className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </Button>
                </div>

                <div className="hidden h-5 w-px bg-[#2a2a2a] md:block" />

                <div className="hidden items-center gap-1 md:flex">
                  <Type className="h-3.5 w-3.5 text-[#666]" strokeWidth={1.5} />
                  <div className="flex items-center gap-0.5 rounded-sm border border-[#2a2a2a] bg-[#0c0c0c]">
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        saveSelectionForToolbar();
                      }}
                      onClick={(e) => stepFontSize(e, -2)}
                      className="flex h-8 w-6 items-center justify-center text-[#bbb] hover:bg-[#252525] hover:text-white"
                      title="Decrease font size"
                    >
                      <MinusIcon className="h-3 w-3" strokeWidth={1.5} />
                    </button>
                    <Input
                      type="number"
                      min={10}
                      max={400}
                      step={1}
                      value={fontSizeInput}
                      onPointerDown={saveSelectionForToolbar}
                      onChange={(e) => setFontSizeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const v = parseInt(fontSizeInput, 10);
                          if (v > 0) setFontSize(v);
                        }
                      }}
                      onMouseDown={(e) => {
                        saveSelectionForToolbar();
                        e.stopPropagation();
                      }}
                      className="no-spin h-8 w-11 rounded-none border-0 bg-transparent px-1 text-center text-xs text-[#e5e5e5] focus-visible:ring-0"
                      title="Font size px (Enter to apply)"
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        saveSelectionForToolbar();
                      }}
                      onClick={(e) => stepFontSize(e, 2)}
                      className="flex h-8 w-6 items-center justify-center text-[#bbb] hover:bg-[#252525] hover:text-white"
                      title="Increase font size"
                    >
                      <PlusIcon className="h-3 w-3" strokeWidth={1.5} />
                    </button>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-sm px-2 text-[10px] font-medium uppercase tracking-wider text-[#888] hover:bg-[#252525] hover:text-white"
                    onMouseDown={protectToolbarSelection}
                    onClick={() => {
                      const v = parseInt(fontSizeInput, 10);
                      if (v > 0) setFontSize(v);
                    }}
                    title="Apply font size"
                  >
                    Set
                  </Button>
                  <select
                    onPointerDown={saveSelectionForToolbar}
                    onMouseDown={saveSelectionForToolbar}
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setFontFamily(e.target.value);
                      e.currentTarget.value = "";
                    }}
                    className="h-8 rounded-sm border border-[#2a2a2a] bg-[#0c0c0c] px-1.5 text-[10px] uppercase tracking-wider text-[#bbb] hover:bg-[#1f1f1f]"
                    title="Font family (applies to selection, or sets canvas default)"
                  >
                    <option value="">Font…</option>
                    {FONT_FAMILIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="hidden h-5 w-px bg-[#2a2a2a] md:block" />

                {/* Layout sliders — horizontal margins + vertical leading. */}
                <div className="hidden items-center gap-3 md:flex">
                  <div className="flex items-center gap-1.5" title="Horizontal margins">
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#888]">
                      H
                    </span>
                    <Slider
                      className="w-20"
                      min={0}
                      max={40}
                      step={1}
                      value={[settings.marginH]}
                      onValueChange={([v]) => setSettings((s) => ({ ...s, marginH: v }))}
                      aria-label="Horizontal text margins"
                    />
                    <span className="w-7 text-right font-mono text-[9px] tabular-nums text-[#bbb]">
                      {settings.marginH}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5" title="Line height / leading">
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#888]">
                      V
                    </span>
                    <Slider
                      className="w-20"
                      min={100}
                      max={250}
                      step={5}
                      value={[Math.round(settings.lineHeight * 100)]}
                      onValueChange={([v]) =>
                        setSettings((s) => ({ ...s, lineHeight: Number((v / 100).toFixed(2)) }))
                      }
                      aria-label="Line height"
                    />
                    <span className="w-8 text-right font-mono text-[9px] tabular-nums text-[#bbb]">
                      {settings.lineHeight.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="hidden h-5 w-px bg-[#2a2a2a] md:block" />

                <div className="hidden items-center gap-1.5 md:flex">
                  <div className="flex items-center gap-0.5 rounded-sm border border-[#2a2a2a] bg-[#0c0c0c] p-0.5 text-[10px]">
                    {(["text", "highlight", "background"] as const).map((scope) => (
                      <button
                        key={scope}
                        type="button"
                        onMouseDown={protectToolbarSelection}
                        onClick={() => setColorScope(scope)}
                        className={`px-1.5 py-1 rounded-sm uppercase tracking-wider transition-colors ${
                          colorScope === scope
                            ? "bg-[#252525] text-white"
                            : "text-[#666] hover:text-[#bbb]"
                        }`}
                      >
                        {scope === "text" ? "Txt" : scope === "highlight" ? "Hl" : "Bg"}
                      </button>
                    ))}
                  </div>
                  <input
                    type="color"
                    value={
                      colorScope === "text"
                        ? textColor
                        : colorScope === "highlight"
                          ? highlightColor
                          : settings.bgColor
                    }
                    onPointerDown={saveSelectionForToolbar}
                    onMouseDown={saveSelectionForToolbar}
                    onChange={(e) => {
                      const c = e.target.value;
                      if (colorScope === "text") setTextColor(c);
                      else if (colorScope === "highlight") setHighlightColor(c);
                      else setSettings((s) => ({ ...s, bgColor: c }));
                    }}
                    onBlur={(e) => applyColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded-sm border border-[#2a2a2a] bg-transparent"
                    title={`${colorScope} color`}
                  />
                  <button
                    type="button"
                    onMouseDown={protectToolbarSelection}
                    onClick={invertSelection}
                    className="px-1.5 py-1 rounded-sm uppercase tracking-wider transition-colors text-[#666] hover:text-[#bbb] hover:bg-[#252525] text-[10px]"
                    title="Invert selected text color"
                  >
                    Inv
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 rounded-sm p-0 text-[#bbb] hover:bg-[#252525] hover:text-white"
                    onMouseDown={protectToolbarSelection}
                    onClick={clearHighlight}
                    title="Clear highlight"
                  >
                    <Highlighter className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </Button>
                </div>

                <div className="h-5 w-px bg-[#2a2a2a]" />
              </>
            )}
                <div className="h-6 w-px shrink-0 bg-[#2a2a2a]" />
              {/* Unified Bookmark tool group — Add + Marks list sit together
                  and use oversized icons for live-production visibility. */}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 w-8 rounded-sm p-0 text-[#bbb] hover:bg-[#252525] hover:text-white"
                title="Drop bookmark at cursor (⌘K)"
                onPointerDown={saveSelectionForToolbar}
                onMouseDown={(e) => {
                  e.preventDefault();
                  saveSelectionForToolbar();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  dropBookmarkAtCaret();
                }}
              >
                <BookmarkPlus className="h-6 w-6" strokeWidth={1.75} />
              </Button>
              <Popover open={bookmarksOpen} onOpenChange={setBookmarksOpen}>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-sm px-2.5 text-[10px] font-medium uppercase tracking-wider text-[#bbb] hover:bg-[#252525] hover:text-white"
                    title="Bookmarks"
                  >
                    <Bookmark className="h-6 w-6 sm:mr-1.5" strokeWidth={1.75} />
                    <span className="hidden sm:inline">Marks</span>
                    <span className="ml-1 text-[#666]">{bookmarkItems.length}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-80 max-h-[70vh] overflow-y-auto rounded-sm border-[#2a2a2a] bg-[#141414] p-0 text-[#e5e5e5] shadow-xl"
                >
                  <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#2a2a2a] bg-[#141414] px-3 py-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#888]">
                      Bookmarks
                    </span>
                    <span className="text-[10px] text-[#555]">{bookmarkItems.length}</span>
                  </div>
                  {bookmarkItems.length === 0 ? (
                    <div className="px-3 py-6 text-center text-[11px] text-[#666]">
                      No bookmarks yet. <br />
                      <span className="text-[#555]">⌘K to drop one at the cursor.</span>
                    </div>
                  ) : (
                    <ul className="divide-y divide-[#222]">
                      {bookmarkItems.map((item, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            onClick={() => {
                              jumpToBookmarkItem(item);
                              setBookmarksOpen(false);
                            }}
                            className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[#1f1f1f]"
                          >
                            {item.kind === "heading" ? (
                              <Type
                                className="mt-0.5 h-3 w-3 shrink-0 text-[#888]"
                                strokeWidth={1.5}
                              />
                            ) : (
                              <Bookmark
                                className="mt-0.5 h-3 w-3 shrink-0 text-[#4d8bff]"
                                strokeWidth={1.5}
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[11px] text-white">{item.label}</div>
                              <div className="truncate text-[9px] uppercase tracking-[0.18em] text-[#666]">
                                {item.kind === "heading" ? "Heading" : `Mark · ${item.blockTitle}`}
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </PopoverContent>
              </Popover>
                <div className="h-6 w-px shrink-0 bg-[#2a2a2a]" />
              {/* Native TTS controls — read the script aloud on-device. */}
              <div className="flex shrink-0 items-center gap-1 border-l border-[#2a2a2a] pl-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className={`h-8 w-8 rounded-sm p-0 hover:bg-[#252525] hover:text-white ${ttsSpeaking ? "text-[#4d8bff]" : "text-[#bbb]"}`}
                  title="Read Script aloud"
                  aria-label="Read script aloud"
                  onClick={readScriptAloud}
                >
                  <Volume2 className="h-5 w-5" strokeWidth={1.75} />
                </Button>
                {ttsSpeaking && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 rounded-sm p-0 text-[#4d8bff] hover:bg-[#252525] hover:text-white"
                    title="Stop audio"
                    aria-label="Stop audio"
                    onClick={ttsCancel}
                  >
                    <SquareIcon className="h-5 w-5" strokeWidth={2} fill="currentColor" />
                  </Button>
                )}
              </div>
                <div className="h-6 w-px shrink-0 bg-[#2a2a2a]" />
              <Button
                size="sm"
                variant="secondary"
                className="h-8 rounded-sm border border-[#2a2a2a] bg-transparent px-2 text-[10px] font-medium uppercase tracking-wider text-[#bbb] shadow-none hover:bg-[#1f1f1f] hover:text-white"
                onClick={launchExtended}
                title="Open clean prompt window on a second screen"
              >
                <ExternalLink className="h-3 w-3 sm:mr-1" strokeWidth={1.5} />{" "}
                <span className="hidden sm:inline">Ext</span>
              </Button>
              {/* Script prep: import, smart auto-format, and .prompt session I/O */}
              <input
                ref={scriptImportInputRef}
                type="file"
                accept=".docx,.doc,.pdf,.rtf,.txt,.md,.prompt"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = "";
                  if (files.length) void importScriptFiles(files);
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                className="h-8 rounded-sm border border-[#2a2a2a] bg-transparent px-2 text-[10px] font-medium uppercase tracking-wider text-[#bbb] shadow-none hover:bg-[#1f1f1f] hover:text-white"
                onClick={() => scriptImportInputRef.current?.click()}
                title="Import a script (.docx, .pdf, .rtf, .txt) — or just drag it onto the canvas"
              >
                <FileUp className="h-3 w-3 sm:mr-1" strokeWidth={1.5} />{" "}
                <span className="hidden sm:inline">Import</span>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 rounded-sm border border-[#2a2a2a] bg-transparent px-2 text-[10px] font-medium uppercase tracking-wider text-[#bbb] shadow-none hover:bg-[#1f1f1f] hover:text-white"
                onClick={runSmartFormat}
                title="Smart Auto-Formatter — curly quotes, em dashes, clean bullets, speech-rhythm line breaks"
              >
                <Pilcrow className="h-3 w-3 sm:mr-1" strokeWidth={1.5} />{" "}
                <span className="hidden sm:inline">FMT</span>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 rounded-sm border border-[#2a2a2a] bg-transparent px-2 text-[10px] font-medium uppercase tracking-wider text-[#bbb] shadow-none hover:bg-[#1f1f1f] hover:text-white"
                onClick={handleExportPromptFile}
                title="Save the whole workspace (script, colors, speed, margins) as a .prompt session"
              >
                <PackageOpen className="h-3 w-3 sm:mr-1" strokeWidth={1.5} />{" "}
                <span className="hidden sm:inline">.prompt</span>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className={`h-8 rounded-sm border px-2 text-[10px] font-medium uppercase tracking-wider shadow-none ${blank ? "border-[#0055ff]/60 bg-[#0055ff]/20 text-[#4d8bff] hover:bg-[#0055ff]/30" : "border-[#2a2a2a] bg-transparent text-[#bbb] hover:bg-[#1f1f1f] hover:text-white"}`}
                onClick={toggleBlank}
                title="Black out the extended display"
              >
                <EyeOff className="h-3 w-3 sm:mr-1" strokeWidth={1.5} />{" "}
                <span className="hidden sm:inline">Blank</span>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className={`h-8 rounded-sm border px-2 text-[10px] font-medium uppercase tracking-wider shadow-none ${tieDye ? "border-[#0055ff]/60 bg-[#0055ff]/20 text-[#4d8bff] hover:bg-[#0055ff]/30" : "border-[#2a2a2a] bg-transparent text-[#bbb] hover:bg-[#1f1f1f] hover:text-white"}`}
                onClick={toggleTieDye}
                title="ATTN — psychedelic tie-dye flash on all displays"
              >
                <Sparkles className="h-3 w-3 sm:mr-1" strokeWidth={1.5} />{" "}
                <span className="hidden sm:inline">Attn</span>
              </Button>
              {/* "Play Along Lobby" moved into the connection group in Row 1
                  (next to the room code) as the Manage Crew dropdown. */}
              {hydrated && role === "host" && !isOnline && (
                <span
                  role="status"
                  aria-live="polite"
                  title="No internet connection — edits are saved locally and will sync when you reconnect."
                  className="ml-1 inline-flex h-8 items-center gap-1 rounded-sm border border-[#0055FF] bg-[#0055FF]/15 px-2 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#8ab0ff]"
                >
                  <span className="text-[10px] leading-none">⚡</span>
                  <span className="hidden sm:inline">Offline — Local Save Only</span>
                  <span className="sm:hidden">Offline</span>
                </span>
              )}
              {/* License / trial countdown. Non-intrusive and clickable — the
                  master key unlocks lifetime use from here. */}
              {hydrated && (
              <button
                type="button"
                onClick={() => setLicenseOpen(true)}
                title={
                  license.status === "lifetime_unlocked"
                    ? "Lifetime unlocked"
                    : license.status === "expired"
                      ? "Trial expired — enter a product key"
                      : `Trial: ${license.daysLeft} day${license.daysLeft === 1 ? "" : "s"} left`
                }
                className={`ml-1 inline-flex h-8 items-center gap-1 rounded-sm border px-2 font-mono text-[9px] font-bold uppercase tracking-[0.18em] transition-colors ${
                  license.status === "lifetime_unlocked"
                    ? "border-[#2a2a2a] bg-[#141414] text-[#9ee5a1] hover:bg-[#1f1f1f]"
                    : license.status === "expired"
                      ? "border-[#0055FF] bg-[#0055FF]/20 text-[#8ab0ff] hover:bg-[#0055FF]/30"
                      : "border-[#2a2a2a] bg-[#141414] text-[#e5e5e5] hover:bg-[#1f1f1f]"
                }`}
              >
                {license.status === "lifetime_unlocked"
                  ? "Licensed"
                  : license.status === "expired"
                    ? "Trial Expired"
                    : `Trial: ${license.daysLeft}d`}
              </button>
              )}
              {!authUser && (
                <button
                  type="button"
                  onClick={() => setSignInOpen(true)}
                  title="Sign in to enable Play Along multiplayer hosting"
                  className="ml-1 inline-flex h-8 items-center gap-1 rounded-sm border border-[#2a2a2a] bg-[#141414] px-2 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#bbb] hover:bg-[#1f1f1f] hover:text-white"
                >
                  <span className="hidden sm:inline">Sign In</span>
                  <span className="sm:hidden">Sign In</span>
                </button>
              )}
              <Popover open={markerPickerOpen} onOpenChange={setMarkerPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    title="Prompt Mode config — choose the eyeline marker"
                    aria-label="Prompt mode marker config"
                    className="flex h-8 w-9 shrink-0 items-center justify-center rounded-sm border border-[#2a2a2a] bg-[#0c0c0c] text-center font-mono text-[13px] leading-none text-[#4d8bff] shadow-[inset_0_0_4px_rgba(0,0,0,0.6)] outline-none hover:border-[#0055ff]/60"
                  >
                    {eyelineMarker === DEFAULT_MARKER ? (
                      <BubblyArrow size={16} color="#4d8bff" />
                    ) : (
                      eyelineMarker
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-64 rounded-sm border-[#2a2a2a] bg-[#141414] p-3 text-zinc-200"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#4d8bff]">
                      Prompt Mode Config
                    </span>
                    <span className="text-[9px] uppercase tracking-[0.18em] text-[#666]">
                      Eyeline Marker
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {MARKER_OPTIONS.map((opt) => {
                      const active = eyelineMarker === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setEyelineMarker(opt.value)}
                          title={opt.label}
                          aria-label={`Marker: ${opt.label}`}
                          aria-pressed={active}
                          className={`relative flex h-10 w-10 items-center justify-center rounded-sm border text-[18px] leading-none transition-colors ${
                            active
                              ? "border-[#0055ff] bg-[#0055ff]/15 text-white shadow-[0_0_0_1px_#0055ff]"
                              : "border-[#2a2a2a] bg-[#0c0c0c] text-[#bbb] hover:border-[#444] hover:text-white"
                          }`}
                        >
                          {opt.value === DEFAULT_MARKER ? (
                            <BubblyArrow size={20} color={active ? "#ffffff" : "#bbbbbb"} />
                          ) : (
                            opt.value
                          )}
                          {active && opt.value !== DEFAULT_MARKER && (
                            <span
                              role="button"
                              aria-label="Reset marker to default"
                              title="Reset to default arrow"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEyelineMarker(DEFAULT_MARKER);
                              }}
                              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-[#2a2a2a] bg-[#1a1a1a] text-[#bbb] hover:bg-[#0055ff] hover:text-white"
                            >
                              <X className="h-2.5 w-2.5" strokeWidth={2} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[10px] leading-snug text-[#666]">
                    Selected marker mirrors on both edges of the prompter in Prompt Mode.
                  </p>
                  <label className="mt-3 flex cursor-pointer items-center justify-between border-t border-[#2a2a2a] pt-2 text-[10px] uppercase tracking-[0.18em] text-[#bbb]">
                    Live edit alerts in Prompt Mode
                    <input
                      type="checkbox"
                      checked={tallyInPrompt}
                      onChange={toggleTallyInPrompt}
                      className="h-3.5 w-3.5 accent-[#0055ff]"
                    />
                  </label>
                </PopoverContent>
              </Popover>
              <Button
                size="sm"
                variant="ghost"
                className={`h-8 w-8 rounded-sm p-0 hover:bg-[#252525] hover:text-white ${
                  isEditZoomed ? "bg-[#252525] text-[#4d8bff]" : "text-[#888]"
                }`}
                onClick={() => setIsEditZoomed((z) => !z)}
                title={
                  isEditZoomed
                    ? "Edit view: 30% — click for full size"
                    : "Edit view: shrink text to 30% (editing only, never affects Prompt Mode)"
                }
                aria-pressed={isEditZoomed}
              >
                {isEditZoomed ? (
                  <ZoomIn className="h-3.5 w-3.5" strokeWidth={1.5} />
                ) : (
                  <ZoomOut className="h-3.5 w-3.5" strokeWidth={1.5} />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className={`h-8 w-8 rounded-sm p-0 hover:bg-[#252525] hover:text-white ${
                  findOpen ? "bg-[#252525] text-white" : "text-[#888]"
                }`}
                onClick={() => (findOpen ? setFindOpen(false) : openFind())}
                title="Find & replace (⌘F)"
              >
                <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 rounded-sm p-0 text-[#888] hover:bg-[#252525] hover:text-white"
                onClick={() => {
                  try {
                    exportShowPdf("Show", blocks);
                    toast.success("Printing show to PDF…");
                  } catch {
                    toast.error("Could not export PDF");
                  }
                }}
                title="Print Show — export to PDF (one page per block)"
              >
                <Printer className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
              <div
                className="flex h-8 items-center gap-1 rounded-sm border border-[#2a2a2a] bg-[#0c0c0c] px-2 text-[10px] uppercase tracking-wider text-[#888]"
                title={`${totalWords} words · ETA at current speed`}
              >
                <TimerIcon className="h-3 w-3 text-[#0055ff]" strokeWidth={1.5} />
                <span className="tabular-nums text-[#4d8bff]">ETA {etaLabel}</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className={`h-8 w-8 rounded-sm p-0 hover:bg-[#252525] hover:text-white ${
                  stageTimerOpen ? "bg-[#252525] text-[#4d8bff]" : "text-[#888]"
                }`}
                onClick={() => setStageTimerOpen((v) => !v)}
                title="Stage timer (LED clock)"
              >
                <Clock3 className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
              {hydrated && user && (
                <div className="ml-1 flex items-center gap-1.5 border-l border-[#2a2a2a] pl-2">
                  <PresenceBar peers={peers} selfUserId={user.id} />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 rounded-sm p-0 text-[#666] hover:bg-[#252525] hover:text-white"
                    onClick={() => signOut()}
                    title={`Sign out (${user.name})`}
                  >
                    <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="fixed bottom-3 left-1/2 z-50 hidden -translate-x-1/2 items-center gap-2 rounded-sm border border-[#2a2a2a] bg-[#141414]/90 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[#666] backdrop-blur sm:flex">
            <Pencil className="h-2.5 w-2.5" strokeWidth={1.5} /> Edit
            <span className="text-[#555]">⌘K Mark · ⌘[ ⌘] Jump · E Prompt Mode</span>
          </div>
        </>
      )}

      {/* Edit-mode marker/config handle. Prompt Mode renders its own single
          mirrored marker pair below; never mount both implementations. */}
      {settings.showArrow && mode === "edit" && (
        <Popover open={arrowMenuOpen} onOpenChange={setArrowMenuOpen}>
          <PopoverTrigger asChild>
          <div
              ref={editArrowRef}
              className="fixed left-0 z-40 -translate-y-1/2"
              style={{ top: `${eyelineY * 100}%`, cursor: displayOnly ? "default" : "ns-resize" }}
              onMouseDown={(e) => {
                if (!displayOnly) {
                  e.preventDefault();
                  draggingEye.current = true;
                }
              }}
              onTouchStart={() => {
                if (!displayOnly) draggingEye.current = true;
              }}
              onTouchEnd={() => {
                draggingEye.current = false;
              }}
              onContextMenu={(e) => {
                if (!displayOnly && role === "host") {
                  e.preventDefault();
                  setArrowMenuOpen(true);
                }
              }}
              aria-label="Eyeline marker"
            >
              {eyelineMarker && eyelineMarker !== DEFAULT_MARKER ? (
                <span
                  className="block select-none leading-none"
                  style={{
                    fontSize: `${triSize}px`,
                    color: settings.triangleColor,
                    lineHeight: 1,
                  }}
                >
                  {eyelineMarker}
                </span>
              ) : (
                <BubblyArrow size={triSize} color={settings.triangleColor} />
              )}
            </div>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            className="w-56 space-y-3 bg-[#141414] border-[#2a2a2a] text-zinc-200"
          >
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span>Arrow size</span>
                <span className="tabular-nums text-zinc-400">{settings.triangleSize}px</span>
              </div>
              <Slider
                min={16}
                max={120}
                step={2}
                value={[settings.triangleSize]}
                onValueChange={([v]) => setSettings((s) => ({ ...s, triangleSize: v }))}
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span>Arrow color</span>
              <input
                type="color"
                value={settings.triangleColor}
                onChange={(e) => setSettings((s) => ({ ...s, triangleColor: e.target.value }))}
                className="h-7 w-12 cursor-pointer rounded border border-[#2a2a2a] bg-transparent"
              />
            </div>
          </PopoverContent>
        </Popover>
      )}
      {!displayOnly && mode === "edit" && settings.showGuide && (
        <div
          className="pointer-events-none fixed left-0 z-30 h-px w-full opacity-25"
          style={{ top: `${eyelineY * 100}%`, backgroundColor: settings.triangleColor }}
        />
      )}

      {/* ---- Virtual Rollerball ----
          Touch-only stand-in for a physical rotary encoder. Drives the LERP
          loop's TARGET velocity (`speedRef`); releasing snaps the target to 0
          so the existing inertia easing decays the scroll smoothly. */}
      {/* Exit Prompt Mode — always available on touch (no keyboard/Esc there),
          and fades in on desktop when the pointer wakes. */}
      {!displayOnly && mode === "prompt" && editModeAllowed && (
        <button
          type="button"
          title="Exit Prompt Mode"
          aria-label="Exit Prompt Mode"
          onClick={() => switchMode("edit")}
          className="fixed right-2 top-2 z-[70] flex h-9 w-9 items-center justify-center rounded-full border border-[#2a2a2a] bg-black/70 text-[#a3a3a3] backdrop-blur transition-opacity hover:text-white"
          style={{ opacity: isMobile || cursorActive ? 0.85 : 0 }}
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      )}

      {/* Client-side role lock: a remote participant without edit rights is
          locked into Prompt Mode and told so persistently. The moment the host
          promotes them to Editor, the banner disappears and the Exit-to-Edit
          control above becomes available. */}
      {!displayOnly && role === "client" && !editModeAllowed && !viewerLetterbox && (
        <div className="pointer-events-none fixed left-1/2 top-2 z-[70] -translate-x-1/2 rounded-sm border border-[#0055FF]/70 bg-black/85 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-[#4d8bff] backdrop-blur">
          View Only: Waiting for Host Permissions
        </div>
      )}

      {/* Keyboard summon — only when the operator has disabled auto keyboard. */}
      {!displayOnly && !viewerLetterbox && mode === "edit" && !settings.autoKeyboard && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (keyboardSummoned ? setKeyboardSummoned(false) : summonKeyboard())}
          aria-label={keyboardSummoned ? "Hide on-screen keyboard" : "Show on-screen keyboard"}
          title={keyboardSummoned ? "Dismiss keyboard" : "Bring up keyboard"}
          className="fixed bottom-6 right-5 z-[9998] flex h-11 w-11 items-center justify-center rounded-full border border-[#2a2a2a] bg-black/70 text-lg text-[#4d8bff] backdrop-blur transition-colors active:bg-[#0055FF]/30"
          style={{ opacity: keyboardSummoned ? 1 : 0.6 }}
        >
          ⌨
        </button>
      )}

      {!displayOnly && !viewerLetterbox && mode === "prompt" && isMobile && (
        <div
          className="select-none opacity-70 transition-opacity active:opacity-100"
          style={{ position: "fixed", right: "5%", bottom: "10%", zIndex: 9999, touchAction: "none" }}
        >
          <div className="flex flex-col items-center gap-1 rounded-full border border-[#2a2a2a] bg-black/60 px-2 py-3 backdrop-blur">
            <span className="text-[9px] uppercase tracking-widest text-[#4d8bff]">
              {rollerValue > 0 ? "▼" : rollerValue < 0 ? "▲" : "•"}
            </span>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.1}
              value={rollerValue}
              aria-label="Virtual rollerball scroll speed"
              onChange={(e) => {
                const v = Number(e.target.value);
                setRollerValue(v);
                speedRef.current = v;
                setSpeed(v);
              }}
              onTouchEnd={() => {
                setRollerValue(0);
                speedRef.current = 0;
                setSpeed(0);
              }}
              onMouseUp={() => {
                setRollerValue(0);
                speedRef.current = 0;
                setSpeed(0);
              }}
              className="h-40 w-6 cursor-ns-resize accent-[#0055ff]"
              style={
                {
                  writingMode: "vertical-lr",
                  WebkitAppearance: "slider-vertical",
                  touchAction: "none",
                } as React.CSSProperties
              }
            />
            <span className="text-[9px] tabular-nums text-[#777]">
              {rollerValue.toFixed(1)}
            </span>
          </div>
        </div>
      )}

      {/* Custom eyeline read-line markers — mirrored on both edges, locked to
          the vertical center, with a glow so they stay visible on black.
          Positioned just outside the text canvas so they never obscure the
          script even when marginH is 0. */}
      {mode === "prompt" && settings.showArrow && (
        <div
          ref={markerTrackRef}
          className="pointer-events-none fixed inset-x-0 z-40 -translate-y-1/2 select-none"
          style={
            viewerLetterbox
              ? {
                  // Markers ride the letterboxed "host screen", not the phone
                  // viewport, so the eyeline lands on the same line as the host.
                  height: 0,
                  top: `${lbTop + eyelineY * lbBoxH}px`,
                  left: `${lbLeft}px`,
                  right: `${lbLeft}px`,
                }
              : { height: 0, top: `${eyelineY * 100}%` }
          }
        >
          <div
            className="absolute left-2 top-1/2 -translate-y-1/2 select-none leading-none"
            style={{
              color: settings.triangleColor,
              fontSize: `${promptMarkerSize}px`,
              filter: "drop-shadow(0 0 6px currentColor)",
            }}
            aria-hidden
          >
            {eyelineMarker === DEFAULT_MARKER ? (
              <BubblyArrow size={promptMarkerSize} color={settings.triangleColor} />
            ) : (
              eyelineMarker
            )}
          </div>
          {settings.mirrorArrow && (
            <div
              className="absolute right-2 top-1/2 -translate-y-1/2 select-none leading-none"
              style={{
                color: settings.triangleColor,
                fontSize: `${promptMarkerSize}px`,
                filter: "drop-shadow(0 0 6px currentColor)",
                transform: "scaleX(-1)",
              }}
              aria-hidden
            >
              {eyelineMarker === DEFAULT_MARKER ? (
                <BubblyArrow size={promptMarkerSize} color={settings.triangleColor} />
              ) : (
                eyelineMarker
              )}
            </div>
          )}
        </div>
      )}

      {settings.showTimer && showHostUi && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-30 rounded bg-black/50 px-3 py-1 text-white text-sm tabular-nums pointer-events-none">
          {mm}:{ss}
        </div>
      )}

      {/* Optional static "stage cue" PIP. Locked (chrome-free) in Prompt Mode
          so it's read-only on stage, fully editable/drag/resize in Edit Mode. */}
      <StagePip
        config={{ ...settings.pip, locked: mode === "prompt" }}
        onChange={(patch) =>
          setSettings((s) => ({ ...s, pip: { ...s.pip, ...patch } }))
        }
      />

      {(displayOnly || (role === "client" && admitted && !viewerLetterbox)) && (
        <div className="fixed bottom-3 right-3 z-[60] flex items-center gap-1 rounded-sm border border-[#2a2a2a] bg-[#0a0a0a]/95 p-1 font-mono shadow-xl">
          <span className="px-1.5 text-[9px] uppercase tracking-[0.18em] text-[#888]">Text Size</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 rounded-sm p-0 text-[#bbb] hover:bg-[#252525] hover:text-white"
            onClick={() => setPlayViewZoom((value) => Math.max(0.5, Number((value - 0.1).toFixed(1))))}
            aria-label="Zoom local view out"
          >
            <MinusIcon className="h-3.5 w-3.5" />
          </Button>
          {/* Discreet local zoom slider — 0.5× to 3.0×, local device only. */}
          <Slider
            className="w-24"
            min={50}
            max={300}
            step={5}
            value={[Math.round(playViewZoom * 100)]}
            onValueChange={([v]) => setPlayViewZoom(Number((v / 100).toFixed(2)))}
            aria-label="Local view zoom"
          />
          <span className="w-10 text-center text-[10px] tabular-nums text-white">
            {Math.round(playViewZoom * 100)}%
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 rounded-sm p-0 text-[#bbb] hover:bg-[#252525] hover:text-white"
            onClick={() => setPlayViewZoom((value) => Math.min(3, Number((value + 0.1).toFixed(1))))}
            aria-label="Zoom local view in"
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {stageTimerOpen && !displayOnly && <StageTimer onClose={() => setStageTimerOpen(false)} />}

      {/* Play Along Command Center — closing this UI never closes the room. */}
      <Dialog open={participantsOpen} onOpenChange={setParticipantsOpen}>
        <DialogContent className="flex max-h-[92vh] max-w-xl flex-col rounded-sm border-[#0055FF]/60 bg-[#0a0a0a] p-0 text-zinc-200">
          <div className="space-y-3 p-5 pb-3">
          <DialogHeader className="space-y-0.5">
            <DialogTitle className="text-[13px] font-semibold uppercase tracking-[0.22em] text-white">
              Play Along Command Center
            </DialogTitle>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#4d8bff]">
              Session: {pin ?? "—"}
            </p>
          </DialogHeader>
          {role === "host" && sessionPin && (
            <div className="space-y-3 rounded-sm border border-[#0055FF]/50 bg-[#0055FF]/10 p-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[#4d8bff]">Active Entry PIN</div>
                  <div className="font-mono text-5xl font-bold tracking-[0.3em] text-white">{sessionPin}</div>
                </div>
                <Button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(playAlongLink);
                      toast.success("Play Along link copied");
                    } catch {
                      toast.error("Unable to copy link");
                    }
                  }}
                  disabled={!isOnline}
                  title={isOnline ? "Copy Play Along invite link" : "Internet connection required for multiplayer Play Along features."}
                  className="h-9 rounded-sm border border-[#0055FF] bg-[#0055FF]/20 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white hover:bg-[#0055FF] disabled:cursor-not-allowed disabled:border-[#3a1a1e] disabled:bg-[#1a0d0f] disabled:text-[#7a4a4a] disabled:hover:bg-[#1a0d0f]"
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy Link
                </Button>
              </div>
              <div className="truncate border-t border-[#0055FF]/30 pt-2 font-mono text-[10px] text-[#aaa]">
                {playAlongLink}
              </div>
              {playAlongLink && (
                <div className="flex flex-col items-center gap-2 border-t border-[#0055FF]/30 pt-3">
                  <div className="rounded-sm bg-white p-3">
                    <QRCodeSVG value={playAlongLink} size={148} level="M" marginSize={0} />
                  </div>
                  <div className="text-[10px] text-[#888]">
                    Scan to follow along on a mobile device.
                  </div>
                </div>
              )}
              {!isOnline && (
                <div className="border-t border-[#0055FF]/30 pt-2 text-[9px] uppercase tracking-[0.16em] text-[#8ab0ff]">
                  ⚡ Offline — Internet connection required for multiplayer Play Along features.
                </div>
              )}
            </div>
          )}
          </div>
          {(() => {
            const connectedPlayers = peers.filter(
              (p) =>
                p.role !== "host" &&
                p.user_id !== user?.id &&
                !kickedUserIds.includes(p.user_id),
            );
            const players = [
              ...connectedPlayers.map((player) => ({
                ...player,
                roleLabel:
                  admittedLobbyPlayers.find((entry) => entry.user_id === player.user_id)?.roleLabel ??
                  "Player",
              })),
              ...admittedLobbyPlayers
                .filter(
                  (entry) =>
                    !connectedPlayers.some((player) => player.user_id === entry.user_id) &&
                    !kickedUserIds.includes(entry.user_id),
                )
                .map((entry) => ({ ...entry, color: "#0055FF", role: "client" as const })),
            ];
            const dirty =
              JSON.stringify(draftPermissions) !== JSON.stringify(permissions);
            const toggle = (uid: string, key: keyof ParticipantPermissions) =>
              setDraftPermissions((prev) => {
                const cur = prev[uid] ?? { ...DEFAULT_OBSERVE_PERMISSIONS };
                const next: ParticipantPermissions = { ...cur, [key]: !cur[key] };
                // Observe-only is mutually exclusive with any edit/scroll grant.
                if (key === "observeOnly" && next.observeOnly) {
                  next.editWhilePrompting = false;
                  next.editInEditMode = false;
                  next.scrollControl = false;
                } else if (key !== "observeOnly" && next[key]) {
                  next.observeOnly = false;
                }
                return { ...prev, [uid]: next };
              });
            const rows: Array<{ key: keyof ParticipantPermissions; label: string }> = [
              // Coarse role presets used by the Viewer/Editor dropdown.
              { key: "observeOnly", label: "Observe Prompt Feed Only" },
              { key: "editWhilePrompting", label: "Allow Edits While Prompting?" },
              { key: "editInEditMode", label: "Allow Edits in Edit Mode?" },
              { key: "scrollControl", label: "Allow Scroll Control?" },
            ];
            const setParticipantRole = (uid: string, next: "viewer" | "editor") =>
              setDraftPermissions((prev) => ({
                ...prev,
                [uid]:
                  next === "editor"
                    ? {
                        observeOnly: false,
                        editWhilePrompting: true,
                        editInEditMode: true,
                        scrollControl: prev[uid]?.scrollControl ?? false,
                      }
                    : { ...DEFAULT_OBSERVE_PERMISSIONS },
              }));
            return (
              <>
                <div className="border-y border-[#1f1f1f] bg-black px-5 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white">Waiting Room</div>
                    <span className="font-mono text-[10px] text-[#4d8bff]">{pendingAdmissions.length} waiting</span>
                  </div>
                  {!isOnline && (
                    <p className="mb-2 rounded-sm border border-[#0055FF]/50 bg-[#0055FF]/10 px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-[#8ab0ff]">
                      ⚡ Offline — Internet connection required for multiplayer Play Along features.
                    </p>
                  )}
                  {pendingAdmissions.length === 0 ? (
                    <p className="py-2 text-[10px] uppercase tracking-[0.14em] text-[#555]">No pending admission requests.</p>
                  ) : (
                    <div className="space-y-2">
                      {pendingAdmissions.map((req) => (
                        <div key={req.clientId} className="flex items-center gap-2 border border-[#2a2a2a] bg-[#101010] px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] font-semibold text-white">{req.name || "Player"}</div>
                            <div className="text-[9px] uppercase tracking-[0.18em] text-[#888]">{req.role}</div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleAdmit(req)}
                            disabled={!isOnline}
                            title={isOnline ? "Admit to Play Along Room" : "Internet connection required for multiplayer Play Along features."}
                            className="h-7 rounded-sm border border-[#5a8a5c] bg-[#5a8a5c]/20 px-3 text-[9px] uppercase tracking-[0.16em] text-[#8fce91] hover:bg-[#5a8a5c]/40 disabled:cursor-not-allowed disabled:border-[#2a3a2a] disabled:bg-[#0f1410] disabled:text-[#4a6a4a] disabled:hover:bg-[#0f1410]"
                          >
                            Admit
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => lobbyDeny(req.clientId, "Denied by host")}
                            disabled={!isOnline}
                            className="h-7 rounded-sm border border-[#0055FF] bg-[#0055FF]/10 px-3 text-[9px] uppercase tracking-[0.16em] text-[#4d8bff] hover:bg-[#0055FF]/30 disabled:cursor-not-allowed disabled:border-[#3a1a1e] disabled:text-[#7a4a4a]"
                          >
                            Deny
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Save bar — changes only commit + broadcast on explicit Save. */}
                <div className="flex items-center justify-between gap-3 border-y border-[#1f1f1f] bg-[#0c0c0c] px-5 py-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#888]">
                      Active Players
                    </div>
                    <div className="text-[9px] uppercase tracking-[0.14em] text-[#555]">
                      {dirty ? "Unsaved changes" : "All changes saved"} · {players.length} player{players.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <Button
                    onClick={() => {
                      setPermissions(draftPermissions);
                      toast.success("Permissions saved & broadcast");
                      setParticipantsOpen(false);
                    }}
                    disabled={!dirty}
                    className="h-9 shrink-0 rounded-sm border border-[#5a8a5c] bg-[#5a8a5c]/20 px-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8fce91] shadow-none hover:bg-[#5a8a5c]/40 disabled:opacity-40"
                  >
                    Save Changes
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-3">
                  {players.length === 0 ? (
                    <p className="py-6 text-center text-[11px] text-[#666]">
                      No players have joined yet.
                      <br />
                      <span className="text-[#555]">Share the Play Along link to invite players.</span>
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {players.map((p) => {
                        const perm = draftPermissions[p.user_id] ?? DEFAULT_OBSERVE_PERMISSIONS;
                        return (
                          <div
                            key={p.user_id}
                            className="rounded-sm border border-[#1f1f1f] bg-[#101010] p-3"
                          >
                            <div className="mb-2 flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: p.color }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[12px] font-medium text-white">
                                  {p.name}
                                </div>
                                <div className="text-[9px] uppercase tracking-[0.16em] text-[#666]">
                                  {p.roleLabel} ·{" "}
                                  <span className="text-[#5a8a5c]">● Connected</span>
                                </div>
                              </div>
                              {/* Coarse RBAC selector — Viewer is locked into
                                  Prompt Mode; Editor may drop into Edit Mode. */}
                              <select
                                value={perm.editInEditMode ? "editor" : "viewer"}
                                onChange={(e) =>
                                  setParticipantRole(
                                    p.user_id,
                                    e.target.value as "viewer" | "editor",
                                  )
                                }
                                className="h-7 shrink-0 rounded-sm border border-[#2a2a2a] bg-[#0c0c0c] px-1.5 text-[10px] uppercase tracking-[0.14em] text-[#bbb] hover:bg-[#1f1f1f]"
                                title="Participant role"
                              >
                                <option value="viewer">Viewer</option>
                                <option value="editor">Editor</option>
                              </select>
                              {/* Targeted 'Kick' — two-step confirm so the host
                                  never ejects a player while reaching for a toggle. */}
                              <button
                                type="button"
                                title={
                                  kickConfirmId === p.user_id
                                    ? "Click again to remove this player"
                                    : "Remove player from room"
                                }
                                onClick={() => {
                                  if (kickConfirmId === p.user_id) {
                                    handleKickUser(p.user_id, p.name);
                                    setKickConfirmId(null);
                                  } else {
                                    setKickConfirmId(p.user_id);
                                  }
                                }}
                                onMouseLeave={() =>
                                  setKickConfirmId((cur) => (cur === p.user_id ? null : cur))
                                }
                                className={
                                  kickConfirmId === p.user_id
                                    ? "flex h-7 shrink-0 items-center gap-1 rounded-sm border border-[#0055FF] bg-[#0055FF] px-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-white"
                                    : "flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[#0055FF]/50 bg-[#0055FF]/10 text-[#4d8bff] hover:bg-[#0055FF]/30"
                                }
                              >
                                {kickConfirmId === p.user_id ? (
                                  <>Kick?</>
                                ) : (
                                  <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                                )}
                              </button>
                            </div>
                            <div className="space-y-1.5">
                              {rows.map((r) => (
                                <label
                                  key={r.key}
                                  className="flex items-center justify-between gap-3 text-[11px] text-[#bbb]"
                                >
                                  <span>{r.label}</span>
                                  <Switch
                                    checked={!!perm[r.key]}
                                    onCheckedChange={() => toggle(p.user_id, r.key)}
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            );
          })()}

          {/* Danger zone — destructive disconnect isolated at the absolute bottom. */}
          {pin && (
            <div className="border-t-2 border-[#0055FF]/60 bg-[#1a0306] px-5 py-4">
              <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.25em] text-[#0055FF]">
                ⚠ Danger Zone
              </div>
              {/* Commit the room preference toggles before the destructive action. */}
              <Button
                onClick={() => {
                  setPermissions(draftPermissions);
                  toast.success("Play Along preferences saved & broadcast");
                  setParticipantsOpen(false);
                }}
                className="mb-2 h-10 w-full rounded-sm border border-[#0055FF] bg-[#0055FF] text-[11px] font-semibold uppercase tracking-[0.2em] text-white shadow-none hover:bg-[#0044cc]"
              >
                Save Room Preferences
              </Button>
              <Button
                onClick={() => setCloseRoomConfirmOpen(true)}
                className="h-10 w-full rounded-sm border border-[#0055FF] bg-transparent text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4d8bff] shadow-none hover:bg-[#0055FF] hover:text-white"
              >
                Close Room &amp; Disconnect All
              </Button>
              <p className="mt-2 text-center text-[10px] uppercase tracking-[0.14em] text-[#666]">
                Disconnects every remote player. You stay connected.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Close Room confirmation — high-friction gate against accidental misclicks */}
      <AlertDialog open={closeRoomConfirmOpen} onOpenChange={setCloseRoomConfirmOpen}>
        <AlertDialogContent className="rounded-sm border-[#0055FF] bg-black text-[#e5e5e5]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[14px] font-semibold uppercase tracking-[0.14em] text-white">
              Close the Play Along Room?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-relaxed text-[#cfcfcf]">
              This immediately disconnects every remote player and archives the
              room. Your own master control workspace stays connected and intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-sm border-[#2a2a2a] bg-[#141414] text-[11px] uppercase tracking-[0.18em] text-[#bbb]">
              Keep Room Open
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setCloseRoomConfirmOpen(false);
                handleCloseRoom();
              }}
              className="rounded-sm border border-[#0055FF] bg-[#0055FF] text-[11px] font-semibold uppercase tracking-[0.18em] text-white hover:bg-[#b3142b]"
            >
              Disconnect All Players
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* First-time edit warning (remote editors) */}
      <AlertDialog open={firstEditWarnOpen} onOpenChange={setFirstEditWarnOpen}>
        <AlertDialogContent className="rounded-sm border-[#0055FF] bg-black text-[#e5e5e5]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[13px] font-semibold uppercase tracking-[0.18em] text-white">
              Hold up, pardner
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-relaxed text-[#cfcfcf]">
              Hey there, pardner. You're about to make a change to a live script
              that the Host owns. Is that okay?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-sm border-[#2a2a2a] bg-[#141414] text-[11px] uppercase tracking-[0.18em] text-[#bbb]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                hasAckFirstEditRef.current = true;
                setFirstEditWarnOpen(false);
              }}
              className="rounded-sm border border-[#0055FF] bg-[#0055FF] text-[11px] font-semibold uppercase tracking-[0.18em] text-white hover:bg-[#b3142b]"
            >
              Accept
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Live prompt-mode danger warning (remote editors) */}
      <AlertDialog open={promptDangerOpen} onOpenChange={setPromptDangerOpen}>
        <AlertDialogContent className="rounded-sm border-[#0055FF] bg-black text-[#e5e5e5]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[14px] font-semibold uppercase tracking-[0.14em] text-white">
              🛑 OI! Wait!
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-relaxed text-[#cfcfcf]">
              🛑 OI! Wait! The host is in prompt mode -- this change may affect the
              flow of the show! Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-[#999]">
            <Checkbox
              checked={promptDangerDontShow}
              onCheckedChange={(v) => setPromptDangerDontShow(!!v)}
            />
            Do not show this warning again
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setPromptDangerDontShow(false)}
              className="rounded-sm border-[#2a2a2a] bg-[#141414] text-[11px] uppercase tracking-[0.18em] text-[#bbb]"
            >
              No
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (promptDangerDontShow) {
                  promptDangerSuppressedRef.current = true;
                  try {
                    localStorage.setItem("tp_prompt_danger_suppressed", "1");
                  } catch {
                    /* ignore */
                  }
                }
                // Acknowledging the danger also satisfies the first-edit gate.
                hasAckFirstEditRef.current = true;
                setPromptDangerOpen(false);
              }}
              className="rounded-sm border border-[#0055FF] bg-[#0055FF] text-[11px] font-semibold uppercase tracking-[0.18em] text-white hover:bg-[#b3142b]"
            >
              Yep
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Bouncer & Lobby gate (remote arrivals, pre-admission) ---- */}
      {isLobbyArrival && !admitted && !roomTerminated && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black p-6">
          <div
            className="w-full max-w-sm rounded-sm border border-[#0055FF] bg-[#0a0a0a] p-6 text-[#e5e5e5] shadow-2xl"
            style={{
              fontFamily:
                "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            }}
          >
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#0055FF]">
              Play Along Room
            </div>
            <div className="mb-5 text-[10px] uppercase tracking-[0.2em] text-[#666]">
              Session {sessionId ?? "—"}
            </div>

            {lobbyStatus === "denied" ? (
              <div className="space-y-4 text-center">
                <div className="text-[13px] font-semibold uppercase tracking-[0.2em] text-[#0055FF]">
                  Entry Denied
                </div>
                <p className="text-[12px] leading-relaxed text-[#bbb]">
                  {lobbyDenyReason || "The host declined your request to join."}
                </p>
                <Button
                  onClick={() => {
                    setLobbyPinInput("");
                    requestJoin({ name: lobbyName.trim(), role: lobbyRole, pin: lobbyPinInput });
                  }}
                  className="h-9 w-full rounded-sm border border-[#2a2a2a] bg-[#141414] text-[11px] uppercase tracking-[0.2em] text-[#bbb] shadow-none hover:bg-[#1f1f1f]"
                  disabled
                >
                  Try Again From The Link
                </Button>
              </div>
            ) : lobbyStatus === "waiting" ? (
              <div className="space-y-4 text-center">
                <div className="flex items-center justify-center gap-2 text-[#4d8bff]">
                  <Radio className="h-4 w-4 animate-pulse" strokeWidth={1.5} />
                  <span className="text-[12px] font-semibold uppercase tracking-[0.25em]">
                    Waiting for Host…
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-[#888]">
                  Your request to join as <span className="text-white">{lobbyName || "guest"}</span>{" "}
                  (<span className="text-[#4d8bff]">{lobbyRole}</span>) has been sent. The host
                  will admit you shortly.
                </p>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (lobbyName.trim().length < 1 || lobbyPinInput.trim().length < 4) return;
                  setSelfRoleLabel(lobbyRole);
                  requestJoin({ name: lobbyName.trim(), role: lobbyRole, pin: lobbyPinInput.trim() });
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-[0.2em] text-[#888]">
                    Session PIN
                  </Label>
                  <Input
                    value={lobbyPinInput}
                    onChange={(e) =>
                      setLobbyPinInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))
                    }
                    inputMode="numeric"
                    placeholder="0000"
                    className="h-10 rounded-sm border-[#2a2a2a] bg-[#0c0c0c] text-center font-mono text-[18px] tracking-[0.4em] text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-[0.2em] text-[#888]">
                    Your Name
                  </Label>
                  <Input
                    value={lobbyName}
                    onChange={(e) => setLobbyName(e.target.value.slice(0, 40))}
                    placeholder="e.g. Vanessa"
                    className="h-10 rounded-sm border-[#2a2a2a] bg-[#0c0c0c] text-[13px] text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-[0.2em] text-[#888]">
                    Your Role
                  </Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {LOBBY_ROLES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setLobbyRole(r)}
                        className={`h-9 rounded-sm border px-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                          lobbyRole === r
                            ? "border-[#0055FF] bg-[#0055FF]/15 text-[#4d8bff]"
                            : "border-[#2a2a2a] bg-[#0c0c0c] text-[#888] hover:bg-[#1f1f1f]"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={lobbyName.trim().length < 1 || lobbyPinInput.trim().length < 4}
                  className="h-10 w-full rounded-sm border border-[#0055FF] bg-[#0055FF] text-[11px] font-semibold uppercase tracking-[0.2em] text-white shadow-none hover:bg-[#b3142b] disabled:opacity-40"
                >
                  Request To Join
                </Button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Host 'Kill Switch' terminated fallback (remote participants) */}
      {roomTerminated && !displayOnly && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-black p-6 text-center">
          <div className="flex items-center gap-2 text-[#0055FF]">
            <AlertTriangle className="h-5 w-5" strokeWidth={1.5} />
            <span className="text-[12px] font-semibold uppercase tracking-[0.3em]">
              Connection Terminated
            </span>
          </div>
          <p
            className="max-w-sm text-[14px] leading-relaxed text-white"
            style={{
              fontFamily:
                "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            }}
          >
            {terminatedByKick
              ? "CONNECTION TERMINATED. You have been removed from the session by the Host."
              : "CONNECTION TERMINATED. The Host has closed the Play Along Room."}
          </p>
        </div>
      )}

      {landerActive && !displayOnly && <LunarLander onExit={() => setLanderActive(false)} />}

      {findOpen && showHostUi && (
        <div
          className="fixed top-4 left-2 right-2 sm:left-auto sm:right-4 z-40 flex flex-wrap items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#141414]/95 px-2 py-1.5 text-[#e5e5e5] shadow-lg backdrop-blur"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setFindOpen(false);
            }
          }}
        >
          <Search className="h-3.5 w-3.5 text-[#888]" />
          <Input
            ref={findInputRef}
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                findStep(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Find"
            className="h-7 w-40 border-[#2a2a2a] bg-[#0a0a0a] px-2 text-xs"
          />
          <Input
            value={findReplace}
            onChange={(e) => setFindReplace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) replaceAll();
                else replaceCurrent();
              }
            }}
            placeholder="Replace"
            className="h-7 w-40 border-[#2a2a2a] bg-[#0a0a0a] px-2 text-xs"
          />
          <span className="min-w-[42px] text-center text-[10px] tabular-nums text-[#888]">
            {findStatus.total > 0 ? `${findStatus.current}/${findStatus.total}` : "0/0"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1.5 text-[#a3a3a3] hover:bg-[#222] hover:text-white"
            title="Match case"
            onClick={() => setFindCase((c) => !c)}
            style={findCase ? { color: "#e5e5e5", background: "#222" } : undefined}
          >
            <CaseUpper className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1.5 text-[#a3a3a3] hover:bg-[#222] hover:text-white"
            title="Previous (Shift+⌘G)"
            onClick={() => findStep(-1)}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1.5 text-[#a3a3a3] hover:bg-[#222] hover:text-white"
            title="Next (⌘G)"
            onClick={() => findStep(1)}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 rounded-sm border border-[#2a2a2a] bg-[#1f1f1f] px-2 text-[10px] uppercase tracking-wider text-[#e5e5e5] hover:bg-[#2a2a2a]"
            onClick={replaceCurrent}
            title="Replace (Enter)"
          >
            Replace
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 rounded-sm border border-[#2a2a2a] bg-[#1f1f1f] px-2 text-[10px] uppercase tracking-wider text-[#e5e5e5] hover:bg-[#2a2a2a]"
            onClick={replaceAll}
            title="Replace all (Shift+Enter)"
          >
            All
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1.5 text-[#a3a3a3] hover:bg-[#222] hover:text-white"
            title="Close (Esc)"
            onClick={() => setFindOpen(false)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Annotation dock — pen / highlighter / notes that live on the script
          and scroll with it, in both Edit and Prompt Mode. */}
      {!displayOnly && !viewerLetterbox && (settings.showAnnotateButton || annotationBarOpen) && (
        <div className="fixed bottom-5 left-1/2 z-[95] -translate-x-1/2">
          {annotationBarOpen ? (
            <div className="flex items-center gap-1 rounded-full border border-[#2a2a2a] bg-[#141414]/95 px-2 py-1.5 text-[#e5e5e5] shadow-2xl backdrop-blur">
              {(
                [
                  { tool: "off", icon: MousePointer2, label: "Select (annotations locked)" },
                  { tool: "pen", icon: Pen, label: "Pen" },
                  { tool: "highlight", icon: Highlighter, label: "Highlighter" },
                  { tool: "text", icon: Type, label: "Text note" },
                  { tool: "erase", icon: Eraser, label: "Erase" },
                ] as Array<{ tool: AnnotationTool; icon: typeof Pen; label: string }>
              ).map(({ tool, icon: Icon, label }) => (
                <button
                  key={tool}
                  type="button"
                  title={label}
                  aria-label={label}
                  onClick={() =>
                    setAnnotationTool((prev) => (prev === tool ? "off" : tool))
                  }
                  className={`rounded-full p-2 transition-colors ${
                    annotationTool === tool
                      ? "bg-[#0055ff] text-white"
                      : "text-[#a3a3a3] hover:bg-[#242424] hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.6} />
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-[#2a2a2a]" />
              <input
                type="color"
                value={annotationColor}
                onChange={(e) => setAnnotationColor(e.target.value)}
                title="Annotation color"
                aria-label="Annotation color"
                className="h-6 w-6 cursor-pointer rounded-full border border-[#2a2a2a] bg-transparent p-0"
              />
              <div className="flex items-center gap-1 px-1" title="Brush size">
                <span className="text-[9px] uppercase tracking-[0.2em] text-[#666]">Size</span>
                <Slider
                  value={[annotationSize]}
                  min={1}
                  max={16}
                  step={1}
                  onValueChange={(v) => setAnnotationSize(v[0] ?? 4)}
                  className="w-16"
                />
              </div>
              <div className="flex items-center gap-1 px-1" title="Annotation opacity">
                <span className="text-[9px] uppercase tracking-[0.2em] text-[#666]">Opacity</span>
                <Slider
                  value={[Math.round(annotationOpacity * 100)]}
                  min={10}
                  max={100}
                  step={5}
                  onValueChange={(v) => setAnnotationOpacity((v[0] ?? 100) / 100)}
                  className="w-16"
                />
              </div>
              <span className="mx-1 h-5 w-px bg-[#2a2a2a]" />
              <button
                type="button"
                title="Find a word in the script"
                aria-label="Find a word in the script"
                onClick={() => {
                  setAnnotationTool("off");
                  openFind();
                }}
                className="rounded-full p-2 text-[#a3a3a3] hover:bg-[#242424] hover:text-white"
              >
                <Search className="h-4 w-4" strokeWidth={1.6} />
              </button>
              <button
                type="button"
                title={annotationsVisible ? "Hide annotations" : "Show annotations"}
                aria-label={annotationsVisible ? "Hide annotations" : "Show annotations"}
                onClick={() => setAnnotationsVisible((v) => !v)}
                className="rounded-full p-2 text-[#a3a3a3] hover:bg-[#242424] hover:text-white"
              >
                {annotationsVisible ? (
                  <Eye className="h-4 w-4" strokeWidth={1.6} />
                ) : (
                  <EyeOff className="h-4 w-4" strokeWidth={1.6} />
                )}
              </button>
              <button
                type="button"
                title="Clear all annotations"
                aria-label="Clear all annotations"
                onClick={clearAnnotations}
                className="rounded-full p-2 text-[#a3a3a3] hover:bg-[#242424] hover:text-white"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.6} />
              </button>
              <button
                type="button"
                title="Close annotation tools"
                aria-label="Close annotation tools"
                onClick={() => {
                  setAnnotationTool("off");
                  setAnnotationBarOpen(false);
                }}
                className="rounded-full p-2 text-[#a3a3a3] hover:bg-[#242424] hover:text-white"
              >
                <X className="h-4 w-4" strokeWidth={1.6} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              title="Annotate script"
              aria-label="Annotate script"
              onClick={() => setAnnotationBarOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[#242424] bg-[#111]/60 text-[#5a5a5a] opacity-50 shadow-lg backdrop-blur transition-opacity hover:opacity-100 hover:text-white"
            >
              <Pen className="h-3.5 w-3.5" strokeWidth={1.6} />
            </button>
          )}
        </div>
      )}

      {!displayOnly && mode === "edit" && settings.showRuler && (
        <MarginRuler
          canvasWidth={CANVAS_WIDTH * totalCanvasScale}
          topOffset={toolbarHidden ? 0 : toolbarH}
          marginH={settings.marginH}
          snap={settings.rulerSnap}
          onChange={(v) => setSettings((prev) => ({ ...prev, marginH: v }))}
        />
      )}

      {/* Letterbox stage — for remote viewers the host's exact viewport box is
          centered and scaled to fit this screen (pillarbox/letterbox bars). */}
      <div
        className={
          viewerLetterbox
            ? "fixed inset-0 z-10 flex items-center justify-center overflow-hidden bg-black"
            : "contents"
        }
        style={viewerLetterbox ? { width: "100vw", height: "100vh" } : undefined}
      >
      <div
        ref={containerRef}
        className={`tp-scroll-container z-10 ${viewerLetterbox ? "relative shrink-0" : "absolute inset-0"} ${mode === "edit" ? "overflow-y-auto" : "overflow-hidden"}`}
        style={
          {
            ...(viewerLetterbox && remoteHostViewport
              ? {
                  // Rigid monitor lock: the host's pixel box, never the local
                  // device width — guarantees identical line breaks.
                  width: `${remoteHostViewport.width}px`,
                  height: `${remoteHostViewport.height}px`,
                  flexShrink: 0,
                  overflow: "hidden",
                  transform: `${flipTransform ? `${flipTransform} ` : ""}scale(${letterboxScale})`,
                  transformOrigin: "center center",
                }
              : { transform: flipTransform || undefined }),
            WebkitOverflowScrolling: "touch",
            // Fixed-width master canvas is scaled down to fit; never let a
            // rounding remainder introduce a horizontal scrollbar.
            overflowX: "hidden",
            // Always allow vertical panning: in Edit Mode this drives native
            // momentum scrolling, in Prompt Mode it keeps the browser from
            // treating drags as gestures we then have to fight.
            touchAction: "pan-y",
          } as React.CSSProperties
        }
        onScroll={(e) => {
          if (mode !== "edit") return;
          const top = (e.currentTarget as HTMLDivElement).scrollTop;
          scrollYRef.current = top;
        }}
        onDragOver={(e) => {
          if (mode !== "edit" || displayOnly) return;
          if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!dropActive) setDropActive(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropActive(false);
        }}
        onDrop={(e) => {
          if (mode !== "edit" || displayOnly) return;
          const files = Array.from(e.dataTransfer.files || []);
          if (!files.length) return;
          e.preventDefault();
          setDropActive(false);
          void importScriptFiles(files);
        }}
      >
        <div
          ref={textRef}
          key={forceShowKey}
          className="relative z-20 opacity-100 will-change-transform"
          style={{
            // Identical outer canvas padding in Edit and Prompt Mode. Prompt
            // movement is transform-only and must never alter text geometry.
            paddingTop: `${settings.marginV}vh`,
            paddingBottom: `${Math.max(40, settings.marginV + 10)}vh`,
            // Iron-clad centering: the canvas wrapper is a full-width flex
            // container that always centers its single child, so the master
            // canvas can never drift off the left edge of the viewport.
            display: "flex",
            justifyContent: "center",
            width: "100%",
            overflowX: "hidden",
            // Rigid-canvas mode: the scaled master canvas is a fixed pixel box
            // whose *layout* width is unscaled, so flexbox centering cannot be
            // trusted (an overflowing flex item snaps to the start edge and
            // the canvas slams to the left). Center it with symmetric padding
            // computed against the scaled width instead.
            ...(fluidMobileEdit
              ? null
              : {
                  justifyContent: "flex-start",
                  paddingLeft: `max(0px, calc((100% - ${CANVAS_WIDTH * totalCanvasScale}px) / 2))`,
                }),
            // The RAF engine owns this transform and mutates the DOM node
            // directly (no React state per frame). On an unrelated re-render
            // we must echo the ref's live value, never the throttled `scrollY`
            // state — otherwise the text snaps back to a stale position.
            transform:
              mode === "edit"
                ? undefined
                : `translate3d(0, ${-(lastTransformYRef.current ?? scrollY)}px, 0)`,
            backfaceVisibility: "hidden",

            // Never let the page collapse when the scaled child shrinks at
            // low editor zoom — that is what made the canvas "vanish".
            minHeight: "100vh",
            opacity: 1,
            visibility: "visible",
            color: "var(--prompter-fg, #fff)",
          }}
        >
          {/* Rigid WYSIWYG mirror: the fixed-width master canvas below is
              NEVER resized. Every zoom (fit-to-screen, viewer slider, pinch,
              editor zoom) is expressed purely as a CSS transform scale on this
              wrapper, so line breaks are byte-identical on every device. */}
          <div
            ref={scaleWrapperRef}
            className="mobile-scale-wrapper"
            style={{
              // Rigid-canvas mode: the OUTER wrapper owns the viewport width
              // and clips overflow, so the inner master canvas can stay at its
              // full pixel width without being crushed to one letter per line.
              // Own the available column width (NOT 100vw — that ignores any
              // surrounding chrome and pushes the centered canvas off-screen).
              width: fluidMobileEdit ? "100%" : `${CANVAS_WIDTH}px`,
              maxWidth: fluidMobileEdit ? "100%" : "none",
              flexShrink: 0,
              overflowX: "hidden",
              display: "flex",
              justifyContent: "center",
              transform: fluidMobileEdit ? "none" : `scale(${totalCanvasScale})`,
              transformOrigin: fluidMobileEdit ? "top center" : "top left",
              height: fluidMobileEdit
                ? undefined
                : canvasNaturalHeight
                  ? `${canvasNaturalHeight * totalCanvasScale}px`
                  : undefined,
            }}
          >
            <div
            ref={canvasRef}
            className={`prompter-canvas prompter-canvas-core ${mode === "edit" ? "tp-edit" : "tp-prompt"}`}
            style={
              {
                boxSizing: "border-box",
                width: fluidMobileEdit ? "100%" : `${CANVAS_WIDTH}px`,
                // The rigid master canvas must NEVER be constrained by the
                // phone viewport — that collapse is the "1-letter" bug.
                maxWidth: fluidMobileEdit ? "100%" : "none",
                whiteSpace: "pre-wrap",
                // Mobile stabilization: the text track can never crush below a
                // readable width on resize / orientation change (the "one
                // letter per line" bug).
                minWidth: fluidMobileEdit ? "250px" : undefined,
                flexShrink: 0,
                marginLeft: "auto",
                marginRight: "auto",
                // Symmetrical squeeze: the H slider is pure inside padding on
                // both edges (box-sizing: border-box), so the block narrows
                // evenly instead of shifting sideways.
                paddingLeft: fluidMobileEdit
                  ? `min(${settings.marginH}%, max(0px, (100% - 250px) / 2))`
                  : `${canvasSidePadding}px`,
                paddingRight: fluidMobileEdit
                  ? `min(${settings.marginH}%, max(0px, (100% - 250px) / 2))`
                  : `${canvasSidePadding}px`,
                // Single source for the unified .trs1-core-text contract used by
                // both Edit and Prompt surfaces — guarantees identical metrics.
                ["--trs1-font-size" as string]: `${displayFontSize}px`,
                ["--trs1-line-height" as string]: `${settings.lineHeight}`,
                ["--trs1-font-family" as string]: settings.fontFamily,
                display: "flex",
                flexDirection: "column",
                // Tight, uniform block spacing (identical in Edit + Prompt so
                // wrapping/scroll parity is preserved).
                gap: BLOCK_GAP,
                position: "relative",
              } as React.CSSProperties
            }
          >
            {annotationsVisible && (
              <AnnotationLayer
                width={CANVAS_WIDTH}
                height={canvasNaturalHeight}
                blockOffsets={blockOffsets}
                annotations={annotations}
                tool={displayOnly ? "off" : annotationTool}
                color={annotationColor}
                size={annotationSize}
                opacity={annotationOpacity}
                scale={totalCanvasScale}
                author={user?.name}
                onAdd={addAnnotation}
                onUpdate={updateAnnotation}
                onRemove={removeAnnotation}
              />
            )}
            {mode === "edit" ? (
              // Continuous WYSIWYG canvas: every non-ghosted block is its own
              // contentEditable, rendered back-to-back with the same font / size /
              // bg / line-height as Prompt mode. Zoom is a LOCAL overview toggle
              // and is never broadcast or persisted to display settings.
              <div
                className="tp-edit-flow"
                style={
                  {
                    transformOrigin: "top center",
                    display: "flex",
                    flexDirection: "column",
                    gap: BLOCK_GAP,
                    position: "relative",
                  } as React.CSSProperties
                }
              >
                {editBlocks.map((b) => (
                  <div
                    key={b.id}
                    data-block-id={b.id}
                    className={
                      b.visibility === "ghosted" || (b.ghosted && b.visibility !== "hidden")
                        ? "ghosted-block"
                        : undefined
                    }
                    style={{ width: "100%", position: "relative" }}
                  >
                    {(() => {
                      const editors = peers.filter(
                        (p) => p.editing_block_id === b.id && p.user_id !== user?.id,
                      );
                      if (editors.length === 0) return null;
                      return (
                        <div className="absolute -top-2 right-0 z-10 flex -space-x-1">
                          {editors.map((p) => (
                            <BlockEditingChip key={p.user_id} peer={p} />
                          ))}
                        </div>
                      );
                    })()}
                    {settings.showHeadings && (
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <div
                            className="tp-block-heading"
                            style={{ cursor: "context-menu" }}
                            title="Right-click for options"
                          >
                            {b.title || "Untitled"}
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem
                            onSelect={() => setSettings((s) => ({ ...s, showHeadings: false }))}
                          >
                            Hide all headings
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={() => {
                              setBlocks((prev) =>
                                prev.map((x) =>
                                  x.id === b.id
                                    ? { ...x, ghosted: true, visibility: "ghosted" as const }
                                    : x,
                                ),
                              );
                              // Auto-bookmark next visible block.
                              const idx = blocks.findIndex((x) => x.id === b.id);
                              const nextBlock = blocks
                                .slice(idx + 1)
                                .find(
                                  (x) =>
                                    !x.ghosted && x.visibility !== "ghosted" && x.visibility !== "hidden",
                                );
                              if (nextBlock) setActiveId(nextBlock.id);
                              toast.success(`"${b.title || "Untitled"}" ghosted`);
                            }}
                          >
                            Ghost block (skip in prompt)
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    )}
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <div>
                          <BlockEditor
                            block={b}
                            isPromptMode={false}
                            isHost={role === "host" && !backupModeLocked}
                            editAllowed={editModeAllowed}
                            bodyStyle={bodyStyle}
                            registerRef={registerEditorRef}
                            registerTiptap={registerTiptapEditor}
                            onFocus={handleEditorFocus}
                            onInput={handleEditorInput}
                            onKeyUp={saveSelection}
                            onMouseUp={saveSelection}
                            collab={collab}
                            onSelect={saveSelection}
                            onBlurEditor={() => {
                              saveSelection();
                            }}
                            onArrowNav={navigateAdjacentBlock}
                            onJumpEdge={jumpEditEdge}
                            onLockedType={role !== "host" ? notifyLocked : undefined}
                            onGuardEdit={role !== "host" ? guardRemoteEdit : undefined}
                          />
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="rounded-sm border-[#2a2a2a] bg-[#101010] text-[#e5e5e5]">
                        <ContextMenuItem
                          disabled={!editModeAllowed}
                          onSelect={() => {
                            const editor = tiptapEditorsRef.current.get(b.id);
                            if (editor) splitBlockAtCursor(b.id, editor);
                          }}
                        >
                          Split into New Block
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={!editModeAllowed || editBlocks[0]?.id === b.id}
                          onSelect={() => removeBlockBreak(b.id)}
                        >
                          Remove Block Break
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  </div>
                ))}
                {/* Giant tap target: on a phone the empty space below the
                    script must activate the editor. Tapping anywhere here
                    focuses the end of the last block. */}
                <div
                  data-editor-tap-target=""
                  style={{ minHeight: "80vh", width: "100%", cursor: "text" }}
                  onTouchStart={focusLastEditor}
                  onClick={focusLastEditor}
                />
              </div>
            ) : (
              // Continuous flow — render every non-ghosted block in normal
              // layout flow so Live mode cannot collapse blocks into the same
              // vertical space.
              <>
                <div
                  aria-hidden="true"
                  data-prompt-spacer="top"
                  className="h-[80vh] w-full shrink-0"
                />
                {promptBlocks.map((b) => (
                  <div
                    key={b.id}
                    data-block-id={b.id}
                    data-bookmark={`block-${b.id}`}
                    data-block-heading={b.id}
                    style={{
                      position: "relative",
                      width: "100%",
                      alignSelf: "stretch",
                      flex: "0 0 auto",
                    }}
                  >
                    {/* LIVE PROMPT SURFACE — the exact same TipTap editor as
                        Edit Mode, with the Yjs collaboration extensions still
                        running, just `editable={false}` (caret hidden in CSS).
                        Remote edits therefore stream in live instead of the
                        stale HTML snapshot this used to render. */}
                    <BlockEditor
                      block={b}
                      isPromptMode={true}
                      isHost={false}
                      editAllowed={false}
                      bodyStyle={bodyStyle}
                      registerRef={registerEditorRef}
                      registerTiptap={registerTiptapEditor}
                      onFocus={handleEditorFocus}
                      onInput={handleEditorInput}
                      onKeyUp={saveSelection}
                      onMouseUp={saveSelection}
                      onSelect={saveSelection}
                      onBlurEditor={saveSelection}
                      collab={collab}
                    />
                  </div>
                ))}
                <div
                  aria-hidden="true"
                  data-prompt-spacer="bottom"
                  className="h-[80vh] w-full shrink-0"
                />
              </>
            )}
          </div>
          </div>
        </div>
      </div>
      </div>

      {/* Blank overlay (extended display only) */}
      {displayOnly && blank && <div className="fixed inset-0 z-[100] bg-black" />}
      {/* FADE TO BLACK (B). Covers the operator's screen too, but stays
          pointer-transparent so the operator can keep scrolling and fixing
          typos "in the dark" while the talent sees nothing. */}
      {!displayOnly && blank && (
        <div
          className="pointer-events-none fixed inset-0 z-[99999] bg-black"
          data-ftb="true"
        >
          <button
            type="button"
            onClick={toggleBlank}
            className="pointer-events-auto absolute left-1/2 top-4 -translate-x-1/2 rounded-sm border border-[#4a4a4a] bg-[#2a2a2a] px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-white shadow-lg hover:bg-[#3a3a3a]"
            title="Restore the blanked screen (B)"
          >
            Restore / Unblank
          </button>
        </div>
      )}
      {/* Operator HUD — host screen only, never the talent pop-out. */}
      {(dropActive || importing) && !displayOnly && (
        <div className="pointer-events-none fixed inset-0 z-[9998] flex items-center justify-center bg-black/70">
          <div className="rounded-md border-2 border-dashed border-[#0055ff] bg-black/90 px-10 py-8 text-center font-mono text-xs uppercase tracking-[0.2em] text-[#8fb4ff]">
            {importing ? "Importing script…" : "Drop script to import"}
            <div className="mt-2 text-[10px] tracking-[0.12em] text-[#4d8bff]">
              .docx · .pdf · .rtf · .txt · .prompt
            </div>
          </div>
        </div>
      )}
      {!displayOnly && (
        <OperatorHUD
          scriptText={hudScriptText}
          speed={speed}
          progress={hudProgress}
          visible={isHudVisible}
          onVisibleChange={setIsHudVisible}
        />
      )}
      {/* Broadcast Tally — operator screen only, never the talent pop-out. */}
      {!displayOnly && !(mode === "prompt" && !tallyInPrompt) && <RemoteEditTally />}

      {/* Failover: client lost host */}
      {!displayOnly && mode === "edit" && role === "client" && pin && hostLost && (
        <div className="fixed left-1/2 top-16 z-[110] -translate-x-1/2 flex flex-col items-center gap-3 rounded-sm border border-[#0055ff] bg-[#0c0c0c] px-5 py-4 text-[#e5e5e5] shadow-2xl">
          <div className="flex items-center gap-2 text-[#4d8bff]">
            <AlertTriangle className="h-4 w-4" strokeWidth={1.5} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.25em]">Host Lost</span>
          </div>
          <div className="max-w-xs text-center text-[11px] text-[#888]">
            No broadcast received from the Host. The script is paused at the current position.
          </div>
          <Button
            size="sm"
            onClick={takeOverAsHost}
            className="rounded-sm border border-[#0055ff] bg-[#0055ff]/20 px-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4d8bff] shadow-none hover:bg-[#0055ff]/40"
          >
            Take Over as Host
          </Button>
        </div>
      )}

      {/* Session modal — only opens when user clicks Sync */}
      {showSessionModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95 p-4">
          <div className="relative w-full max-w-sm rounded-sm border border-[#2a2a2a] bg-[#141414] p-5 text-[#e5e5e5] shadow-2xl">
            <button
              type="button"
              onClick={() => setSessionModalOpen(false)}
              className="absolute right-2 top-2 rounded-sm p-1 text-[#666] hover:bg-[#252525] hover:text-white"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-[#888]">
              Teleprompter Session
            </div>
            <h2 className="mb-3 text-base font-semibold text-white">Go Live</h2>
            <p className="mb-5 text-[11px] leading-relaxed text-[#888]">
              You're in <span className="font-semibold text-white">Solo Mode</span>. Start hosting
              to broadcast over the network, or join an existing session.
            </p>

            <Button
              onClick={() => {
                handleCreateSession();
                setSessionModalOpen(false);
              }}
              className="h-10 w-full rounded-sm border border-[#0055ff] bg-[#0055ff]/15 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4d8bff] shadow-none hover:bg-[#0055ff]/25"
            >
              Link Prompter Display · Generate PIN
            </Button>
            <p className="mb-3 mt-1.5 text-[10px] leading-relaxed text-[#777]">
              Strict, pixel-perfect synchronization for the talent's glass. Locked to the operator's
              screen.
            </p>

            <Button
              onClick={() => {
                handleCreateTestRoom();
              }}
              variant="secondary"
              className="h-10 w-full rounded-sm border border-[#2a2a2a] bg-transparent text-[11px] font-semibold uppercase tracking-[0.2em] text-[#bbb] shadow-none hover:bg-[#1f1f1f] hover:text-white"
            >
              Start a Watch Party · Copy Link
            </Button>
            <p className="mb-3 mt-1.5 text-[10px] leading-relaxed text-[#777]">
              Allow producers and crew to follow the live script on their own devices. Enables local
              zoom controls.
            </p>

            {playAlongLink && (
              <div className="mb-3 flex flex-col items-center gap-2 rounded-sm border border-[#2a2a2a] bg-[#0c0c0c] p-3">
                <div className="w-full truncate text-center font-mono text-[10px] text-[#8ab0ff]">
                  {playAlongLink}
                </div>
                <div className="rounded-sm bg-white p-3">
                  <QRCodeSVG value={playAlongLink} size={148} level="M" marginSize={0} />
                </div>
                <div className="text-[10px] text-[#888]">
                  Scan to follow along on a mobile device.
                </div>
              </div>
            )}

            <div className="my-4 flex items-center gap-2">
              <div className="h-px flex-1 bg-[#2a2a2a]" />
              <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[#555]">
                or join
              </span>
              <div className="h-px flex-1 bg-[#2a2a2a]" />
            </div>

            <div className="space-y-2">
              <Label className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[#888]">
                Session PIN
              </Label>
              <Input
                value={joinInput}
                onChange={(e) => setJoinInput(normalizePin(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleJoinSession();
                }}
                placeholder="ABC123"
                maxLength={6}
                className="h-12 rounded-sm border-[#2a2a2a] bg-[#0c0c0c] text-center font-mono text-xl tracking-[0.5em] uppercase text-white placeholder:text-[#444]"
              />
              <Button
                onClick={() => {
                  handleJoinSession();
                  setSessionModalOpen(false);
                }}
                disabled={joinInput.length !== 6}
                variant="secondary"
                className="h-10 w-full rounded-sm border border-[#2a2a2a] bg-transparent text-[11px] font-medium uppercase tracking-[0.2em] text-[#bbb] shadow-none hover:bg-[#1f1f1f] hover:text-white"
              >
                Join Watch Party
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Extended display: no PIN modal, no waiting screen — pitch black,
          ready to receive broadcast. */}

      <AlertDialog open={newShowOpen} onOpenChange={setNewShowOpen}>
        <AlertDialogContent className="rounded-sm border-[#2a2a2a] bg-[#141414] text-[#e5e5e5]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[#888]">
              New Show
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] leading-relaxed text-[#bbb]">
              Do you want to save the current show before starting a new one? Starting a new show
              wipes the script, resets every layout setting and clears all cached data. Connected
              Producer and Display windows will be cleared too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel className="rounded-sm border-[#2a2a2a] bg-transparent text-[10px] font-medium uppercase tracking-wider text-[#bbb] hover:bg-[#1f1f1f] hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleSaveThenNewShow();
              }}
              className="rounded-sm border border-[#2a2a2a] bg-transparent text-[10px] font-semibold uppercase tracking-wider text-[#e5e5e5] hover:bg-[#1f1f1f]"
            >
              Save
            </AlertDialogAction>
            <AlertDialogAction
              onClick={handleNewShow}
              className="rounded-sm border border-[#0055ff] bg-[#0055ff]/15 text-[10px] font-semibold uppercase tracking-wider text-[#4d8bff] hover:bg-[#0055ff]/25"
            >
              Discard &amp; Start New
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <LicenseModal
        open={licenseOpen || license.status === "expired"}
        onOpenChange={setLicenseOpen}
        lock={license.status === "expired"}
      />
      {license.status === "expired" && !displayOnly && (
        <TrialExpiredScreen onOpenLicense={() => setLicenseOpen(true)} />
      )}
      {signInOpen && !authUser && (
        <div className="fixed inset-0 z-[9998]">
          <button
            type="button"
            aria-label="Close sign-in"
            className="absolute right-4 top-4 z-[10000] rounded-sm border border-[#2a2a2a] bg-[#141414] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#bbb] hover:text-white"
            onClick={() => setSignInOpen(false)}
          >
            Cancel
          </button>
          <LoginScreen />
        </div>
      )}
    </div>
  );
}

// ---- Settings panel -------------------------------------------------------

/**
 * Continuous-canvas block editor — now powered by TipTap / ProseMirror.
 *
 * The ProseMirror editable DOM element (`editor.view.dom`) intentionally
 * carries the exact same contract the legacy contentEditable div did:
 * `data-block-editor`, `data-block-id`, `data-block-heading`, the
 * `tp-editor whitespace-pre-wrap` classes, and the inherited body typography.
 * Every DOM-reading helper in the parent (editorsRef map, caret/scroll
 * measurement, bookmark traversal, snap-to-cursor, cross-block navigation)
 * therefore keeps working unchanged against the rendered DOM — only WRITES
 * (formatting, bookmark insert, persistence, content hydration) are routed
 * through ProseMirror commands so the document state is never corrupted.
 */
function BlockEditorImpl({
  block,
  isPromptMode,
  isHost,
  editAllowed = true,
  bodyStyle,
  registerRef,
  registerTiptap,
  onFocus,
  onInput,
  onKeyUp,
  onMouseUp,
  onSelect,
  onBlurEditor,
  onArrowNav,
  onJumpEdge,
  collab,
  onLockedType,
  onGuardEdit,
}: {
  block: { id: string; body: string };
  isPromptMode: boolean;
  isHost: boolean;
  editAllowed?: boolean;
  bodyStyle: React.CSSProperties;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  registerTiptap: (id: string, editor: Editor | null) => void;
  onFocus: (id: string, el: HTMLDivElement | null) => void;
  onInput: (id: string, getHtml: () => string) => void;
  onKeyUp: () => void;
  onMouseUp: () => void;
  onSelect: () => void;
  onBlurEditor: () => void;
  onArrowNav?: (fromId: string, dir: 1 | -1) => boolean;
  onJumpEdge?: (edge: "first" | "last") => boolean;
  collab?: { doc: YDoc; provider: SupabaseYjsProvider; user: { name: string; color: string } } | null;
  onLockedType?: () => void;
  onGuardEdit?: () => boolean;
}) {
  // In a live session every participant can co-edit through Yjs; solo (no pin)
  // keeps the original single-host editing model untouched. A follower whose
  // host set them to observe-only loses edit access via `editAllowed`.
  const editable = (isHost || !!collab) && editAllowed;
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const onLockedTypeRef = useRef(onLockedType);
  onLockedTypeRef.current = onLockedType;
  const onGuardEditRef = useRef(onGuardEdit);
  onGuardEditRef.current = onGuardEdit;
  const editor = useEditor(
    {
      extensions: getEditorExtensions(
        collab ? { doc: collab.doc, provider: collab.provider, field: block.id, user: collab.user } : undefined,
      ),
      // Collaboration owns the document content; never seed via `content` when
      // collab is active or the initial state double-applies.
      // Mobile/Safari lockout guard: an empty ProseMirror has no text node for
      // the caret to land on, so a blank document can never be focused by tap.
      // Always seed at least one paragraph with a break.
      content: collab
        ? undefined
        : normalizeBookmarkHtml(
            block.body && block.body.trim() !== "" ? block.body : "<p><br></p>",
          ),
      editable,
      // CRITICAL (SSR): TanStack Start renders this component on the server.
      // With the default `immediatelyRender: true`, the editor tries to mount
      // during SSR, producing a hydration mismatch that leaves the visible DOM
      // detached from the live ProseMirror view — the canvas shows text but
      // refuses all input. Deferring the first render to the client fixes it.
      immediatelyRender: false,
      // Perf: TipTap owns the ProseMirror DOM directly, so there is no need
      // to force a full React re-render of the BlockEditor component on
      // every transaction. This removes the per-keystroke React reconcile
      // that was starving input responsiveness in the Electron shell.
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          ...sharedEditorProps.attributes,
          "data-block-id": block.id,
          "data-block-heading": block.id,
          "data-block-editor": "",
        },
        transformPastedHTML: sharedEditorProps.transformPastedHTML,
      },
      onUpdate: ({ editor: ed }) => {
        // Defer HTML serialization + bookmark normalization to the debounced
        // commit so keystrokes stay off the main-thread hot path.
        onInput(block.id, () => ed.getHTML());
      },
      onTransaction: ({ transaction }) => {
        // Broadcast Tally: a doc change carrying the Yjs sync origin means a
        // REMOTE collaborator edited the script. Notify the operator via a
        // native event — never setState here, so the GPU scroll loop and the
        // editor's render path stay untouched.
        if (
          transaction.docChanged &&
          (transaction.getMeta("y-sync$") || transaction.getMeta("isRemote"))
        ) {
          window.dispatchEvent(
            new CustomEvent("remote-script-edit", {
              detail: {
                timestamp: Date.now(),
                name: collab?.provider.lastRemoteEditor ?? null,
              },
            }),
          );
        }
      },
      onFocus: ({ editor: ed }) => {
        onFocus(block.id, ed.view.dom as HTMLDivElement);
      },
      onBlur: () => {
        onBlurEditor();
      },
      onSelectionUpdate: () => {
        onSelect();
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [block.id, collab?.doc],
  );

  // Register both the editable DOM element (for the parent's DOM-based
  // measurement / traversal helpers) and the editor instance (for command
  // routing) once the view exists.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLDivElement;
    registerRef(block.id, dom);
    registerTiptap(block.id, editor);
    // Locked feedback: a read-only follower who tries to type on the canvas
    // gets the retro "VIEW ONLY" toast instead of silent rejection.
    const onLockedKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      const isTyping =
        k.length === 1 || k === "Enter" || k === "Backspace" || k === "Delete";
      if (!isTyping) return;
      // Read-only follower: retro "VIEW ONLY" feedback, edit blocked.
      if (!editableRef.current) {
        e.preventDefault();
        onLockedTypeRef.current?.();
        return;
      }
      // Editable remote collaborator: run high-friction warning gates
      // (first-edit acknowledgement / host-in-prompt-mode danger).
      if (onGuardEditRef.current?.()) {
        e.preventDefault();
      }
    };
    dom.addEventListener("keydown", onLockedKey);
    return () => {
      dom.removeEventListener("keydown", onLockedKey);
      registerRef(block.id, null);
      registerTiptap(block.id, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, block.id]);

  // Toggle editability when the host/backup state changes. Safari can leave a
  // freshly-mounted view stuck read-only when collab wiring throws mid-init,
  // so we re-assert the intended state on the next frame after mount too.
  useEffect(() => {
    if (!editor) return;
    const apply = () => {
      try {
        if (!editor.isDestroyed && editor.isEditable !== editable) editor.setEditable(editable);
      } catch {
        /* never let a view-level failure trap the editor read-only */
      }
    };
    apply();
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
  }, [editor, editable]);

  // Host seeds the shared Yjs fragment from existing HTML exactly once, after a
  // short settle so we don't clobber state already streamed from a peer.
  useEffect(() => {
    if (!collab || !editor || !isHost) return;
    const t = setTimeout(() => {
      const hasText = (block.body || "").replace(/<[^>]+>/g, "").trim().length > 0;
      if (editor.isEmpty && hasText) {
        editor.commands.setContent(normalizeBookmarkHtml(block.body), { emitUpdate: true });
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab, editor, isHost, block.id]);

  // External content sync (rundown reorder / import / remote sync). Never
  // re-set while the user is actively typing here, and only when the HTML
  // actually differs, to avoid caret resets and update loops.
  useEffect(() => {
    if (!editor) return;
    // In collaborative mode Yjs is the single source of truth — never push
    // React-state HTML back into the editor or it fights the shared doc.
    if (collab) return;
    if (editor.isFocused) return;
    const normalized = normalizeBookmarkHtml(block.body || "<p></p>");
    if (normalizeBookmarkHtml(editor.getHTML()) !== normalized) {
      editor.commands.setContent(normalized, { emitUpdate: false });
    }
  }, [editor, block.body, collab]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isHost || !onArrowNav || !editor) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const el = editor.view.dom as HTMLDivElement;
    // Home / End: jump caret to the very first / very last block.
    if (onJumpEdge && (e.key === "Home" || e.key === "End")) {
      if (onJumpEdge(e.key === "Home" ? "first" : "last")) {
        e.preventDefault();
        return;
      }
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      const probe = document.createRange();
      probe.setStart(range.endContainer, range.endOffset);
      probe.setEnd(el, el.childNodes.length);
      if (probe.toString().length === 0) {
        if (onArrowNav(block.id, 1)) e.preventDefault();
      }
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      const probe = document.createRange();
      probe.setStart(el, 0);
      probe.setEnd(range.startContainer, range.startOffset);
      if (probe.toString().length === 0) {
        if (onArrowNav(block.id, -1)) e.preventDefault();
      }
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isHost || !editor) return;
    const t = e.target as HTMLElement;
    const bm = t.closest("[data-bookmark]") as HTMLElement | null;
    if (!bm) return;
    const id = bm.getAttribute("data-bookmark") || "";
    if (!id || id.startsWith("block-")) return;
    e.preventDefault();
    e.stopPropagation();
    // Delete the bookmark atom node via ProseMirror so state stays in sync.
    try {
      const pos = editor.view.posAtDOM(bm, 0);
      editor
        .chain()
        .focus()
        .deleteRange({ from: pos, to: pos + 1 })
        .run();
    } catch {
      /* no-op */
    }
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || !editableRef.current) return;
    const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (!hit) return;
    editor.commands.setTextSelection(hit.pos);
    onFocus(block.id, editor.view.dom as HTMLDivElement);
  };

  // Crash guard: in collaborative (Play Along Room) sessions the editor is
  // null until the Yjs document + Supabase provider finish wiring up. Rendering
  // <EditorContent> against a null/half-initialized collaboration editor is what
  // tripped the fatal error boundary — wait for a truthy editor first.
  if (!editor) {
    return (
      <div
        className="flex items-center gap-2 text-xs text-[#888]"
        style={{ ...bodyStyle, minHeight: "1.5em", cursor: "default" }}
      >
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#0055FF] border-t-transparent" />
        {collab ? "Connecting to session…" : "Loading…"}
      </div>
    );
  }

  return (
    // WebKit failsafe: Safari only reliably hands focus to the ProseMirror
    // surface when its immediate wrapper is itself a focusable click target,
    // and when text selection is explicitly re-enabled (a parent UI shell can
    // otherwise leak `user-select: none` into the editor).
    <div
      className="tp-editor-shell"
      tabIndex={0}
      style={{
        display: "block",
        width: "100%",
        outline: "none",
        WebkitUserSelect: "text",
        userSelect: "text",
        cursor: "text",
      }}
      onMouseDown={(e) => {
        // Clicking the padding around the text should still land the caret.
        if (e.target === e.currentTarget && editor.isEditable) {
          editor.commands.focus();
        }
      }}
      onTouchStart={(event) => {
        // Mobile: a tap on the wrapper padding must open the keyboard.
        if (
          event.target === event.currentTarget &&
          !isPromptMode &&
          editor.isEditable &&
          !editor.isFocused
        ) {
          editor.commands.focus("end");
        }
      }}
      onClick={(event) => {
        // Let ProseMirror handle clicks inside its own DOM so Safari preserves
        // the exact caret position. Only delegate clicks from empty wrapper
        // space; otherwise a bubbling click can move every caret to the end.
        if (
          event.target === event.currentTarget &&
          !isPromptMode &&
          editor.isEditable &&
          !editor.isFocused
        ) {
          editor.commands.focus("end");
        }
      }}
    >
      <EditorContent
        editor={editor}
        className="whitespace-pre-wrap"
        style={{
          ...bodyStyle,
          cursor: "text",
          outline: "none",
          position: "relative",
          height: "auto",
          minHeight: "1.5em",
          display: "block",
          width: "100%",
          WebkitUserSelect: "text",
          userSelect: "text",
        }}
        onKeyUp={onKeyUp}
        onMouseUp={onMouseUp}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />
    </div>
  );
}

/**
 * Perf: the parent Teleprompter re-renders for toolbar / settings / sync
 * state, but a BlockEditor only needs a fresh render when its own identity,
 * content, editability, typography or collab doc changes. Callback props are
 * intentionally excluded from the comparison — the editor reads them through
 * refs or stable useCallback handlers, so an inline arrow must not force a
 * ProseMirror-hosting component to reconcile on every keystroke elsewhere.
 */
const BlockEditor = memo(BlockEditorImpl, (a, b) => {
  if (a.block.id !== b.block.id) return false;
  if (a.block.body !== b.block.body) return false;
  if (a.isPromptMode !== b.isPromptMode) return false;
  if (a.isHost !== b.isHost) return false;
  if (a.editAllowed !== b.editAllowed) return false;
  if (a.collab?.doc !== b.collab?.doc) return false;
  const sa = a.bodyStyle as Record<string, unknown>;
  const sb = b.bodyStyle as Record<string, unknown>;
  const ka = Object.keys(sa);
  if (ka.length !== Object.keys(sb).length) return false;
  return ka.every((k) => sa[k] === sb[k]);
});

function Joystick({ onChange }: { onChange: (value: number) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0); // -RADIUS..RADIUS
  const activeRef = useRef(false);
  const RADIUS = 56;
  // Lerp state: target = where the user is pointing, current = what we emit.
  // The rAF loop drags `current` toward `target` for smooth, weighted feel.
  const targetRef = useRef(0);
  const currentRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const tick = () => {
    const target = targetRef.current;
    const cur = currentRef.current;
    // 8% per frame ≈ ~140 ms time-constant: noticeable drag without lag.
    const next = cur + (target - cur) * 0.08;
    const settled = Math.abs(next - target) < 0.001;
    currentRef.current = settled ? target : next;
    onChange(currentRef.current);
    if (settled && target === 0) {
      rafRef.current = null;
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const ensureLoop = () => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const updateFromY = (clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const dy = center - clientY; // up positive
    const clamped = Math.max(-RADIUS, Math.min(RADIUS, dy));
    setOffset(clamped);
    // Ease the response curve: dead-zone in the middle + soft cubic ramp,
    // so small wrist wobbles don't spike the speed.
    const t = clamped / RADIUS;
    const DEAD = 0.12;
    const mag = Math.abs(t);
    let eased = 0;
    if (mag > DEAD) {
      const norm = (mag - DEAD) / (1 - DEAD);
      eased = Math.sign(t) * Math.pow(norm, 2.6);
    }
    targetRef.current = eased;
    ensureLoop();
  };

  const release = () => {
    activeRef.current = false;
    setOffset(0);
    targetRef.current = 0;
    ensureLoop();
  };

  return (
    <div
      className="fixed bottom-6 right-6 z-[108] touch-none select-none"
      onTouchStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
        activeRef.current = true;
        updateFromY(e.touches[0].clientY);
      }}
      onTouchMove={(e) => {
        if (!activeRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        updateFromY(e.touches[0].clientY);
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        e.stopPropagation();
        release();
      }}
      onTouchCancel={() => release()}
    >
      <div
        ref={baseRef}
        className="relative h-36 w-36 rounded-full border border-white/30 bg-white/10 backdrop-blur-md shadow-2xl"
      >
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-px w-3/4 -translate-x-1/2 -translate-y-1/2 bg-white/20" />
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 shadow-lg"
          style={{
            transform: `translate(-50%, calc(-50% - ${offset}px))`,
            transition: "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  setSettings,
}: {
  settings: PrompterSettings;
  setSettings: React.Dispatch<React.SetStateAction<PrompterSettings>>;
}) {
  const [arrowOpen, setArrowOpen] = useState(false);
  const upd = <K extends keyof PrompterSettings>(k: K, v: PrompterSettings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }));

  return (
    <div className="space-y-4 text-sm">
      <div className="font-semibold text-xs uppercase tracking-wider text-zinc-400">
        Prompter Settings
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.showArrow}
            onChange={(e) => upd("showArrow", e.target.checked)}
          />
          Focus Arrow
        </label>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-white hover:bg-zinc-800"
          onClick={() => setArrowOpen((o) => !o)}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      {arrowOpen && (
        <div className="ml-2 space-y-2 border-l border-zinc-700 pl-3">
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span>Arrow size</span>
              <span className="tabular-nums text-zinc-400">{settings.triangleSize}px</span>
            </div>
            <Slider
              min={16}
              max={120}
              step={2}
              value={[settings.triangleSize]}
              onValueChange={([v]) => upd("triangleSize", v)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Color</Label>
            <input
              type="color"
              value={settings.triangleColor}
              onChange={(e) => upd("triangleColor", e.target.value)}
              className="h-7 w-10 cursor-pointer rounded border border-zinc-700 bg-transparent"
            />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={settings.showGuide}
              onChange={(e) => upd("showGuide", e.target.checked)}
            />
            Show guide line
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={settings.mirrorArrow}
              onChange={(e) => upd("mirrorArrow", e.target.checked)}
            />
            <span>
              Mirror arrow on right edge
              <span className="block text-[10px] text-zinc-500">
                Off by default — arrow stays on the left side only.
              </span>
            </span>
          </label>
        </div>
      )}

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={settings.autoKeyboard}
          onChange={(e) => upd("autoKeyboard", e.target.checked)}
        />
        <span>
          Auto on-screen keyboard
          <span className="block text-[10px] text-zinc-500">
            Off: tapping the script only moves the caret — use the floating ⌨ button to type.
          </span>
        </span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.showTimer}
          onChange={(e) => upd("showTimer", e.target.checked)}
        />
        Show timer
      </label>

      <div className="space-y-2 rounded border border-zinc-800 bg-zinc-950/60 p-2">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={settings.pip.enabled}
              onChange={(e) =>
                upd("pip", { ...settings.pip, enabled: e.target.checked })
              }
            />
            <span className="font-semibold uppercase tracking-wider text-zinc-400">
              Stage Cue (PIP)
            </span>
          </label>
        </div>
        <p className="text-[10px] leading-snug text-zinc-500">
          A draggable, resizable reminder card — city name, "smile 😃", set
          list note, anything. Drag its header to move, corner to resize.
          Locked read-only in Prompt Mode. Local only, never broadcast.
        </p>
        {settings.pip.enabled && (
          <>
            <textarea
              value={settings.pip.text}
              onChange={(e) =>
                upd("pip", { ...settings.pip, text: e.target.value })
              }
              rows={2}
              className="w-full rounded border border-zinc-800 bg-black/60 p-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-600"
              placeholder="You're in Atlantic City, NJ!"
            />
            <div className="flex items-center gap-2 text-[11px]">
              <span className="w-14 text-zinc-400">Text</span>
              <input
                type="color"
                value={settings.pip.textColor}
                onChange={(e) =>
                  upd("pip", { ...settings.pip, textColor: e.target.value })
                }
                className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
              />
              <span className="w-10 text-zinc-400">BG</span>
              <input
                type="color"
                value={settings.pip.bgColor}
                onChange={(e) =>
                  upd("pip", { ...settings.pip, bgColor: e.target.value })
                }
                className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span>Font size</span>
                <span className="tabular-nums text-zinc-400">
                  {settings.pip.fontSize}px
                </span>
              </div>
              <Slider
                min={12}
                max={72}
                step={1}
                value={[settings.pip.fontSize]}
                onValueChange={([v]) =>
                  upd("pip", { ...settings.pip, fontSize: v })
                }
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span>Opacity</span>
                <span className="tabular-nums text-zinc-400">
                  {Math.round((settings.pip.opacity ?? 1) * 100)}%
                </span>
              </div>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[Math.round((settings.pip.opacity ?? 1) * 100)]}
                onValueChange={([v]) =>
                  upd("pip", { ...settings.pip, opacity: v / 100 })
                }
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span>Size (scale)</span>
                <span className="tabular-nums text-zinc-400">
                  {(settings.pip.scale ?? 1).toFixed(2)}×
                </span>
              </div>
              <Slider
                min={50}
                max={250}
                step={5}
                value={[Math.round((settings.pip.scale ?? 1) * 100)]}
                onValueChange={([v]) =>
                  upd("pip", { ...settings.pip, scale: v / 100 })
                }
              />
            </div>
            <button
              type="button"
              onClick={() =>
                upd("pip", {
                  ...settings.pip,
                  x: Math.max(16, window.innerWidth - settings.pip.w - 16),
                  y: 16,
                })
              }
              className="w-full rounded border border-zinc-700 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
            >
              Reset to top-right
            </button>
          </>
        )}
      </div>

      <div className="space-y-2 rounded border border-zinc-800 bg-zinc-950/60 p-2">
        <div className="font-semibold text-[10px] uppercase tracking-wider text-zinc-400">
          Encoder / Remote Tuning
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span>Ramp time</span>
            <span className="tabular-nums text-zinc-400">{settings.encoderRampMs}ms</span>
          </div>
          <Slider
            min={200}
            max={3000}
            step={50}
            value={[settings.encoderRampMs]}
            onValueChange={([v]) => upd("encoderRampMs", v)}
          />
          <div className="text-[10px] text-zinc-500">
            Time to reach full speed under a steady encoder stream. Lower = snappier.
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span>Scroll smoothing / inertia</span>
            <span className="tabular-nums text-zinc-400">
              {settings.scrollInertia.toFixed(2)}
            </span>
          </div>
          <Slider
            min={0.01}
            max={0.5}
            step={0.01}
            value={[settings.scrollInertia]}
            onValueChange={([v]) => upd("scrollInertia", v)}
          />
          <div className="text-[10px] text-zinc-500">
            How heavy the wheel feels. Lower = smoother deceleration on
            reversal; higher = snappier / more direct.
          </div>
        </div>
        {/* Placeholder control — intentionally inert until the feature lands. */}
        <div
          className="space-y-1 opacity-70"
          onPointerDown={() => toast("Hilarity Knob: Coming Soon...")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") toast("Hilarity Knob: Coming Soon...");
          }}
        >
          <div className="flex justify-between text-xs">
            <span className="flex items-center gap-1">
              <Sliders className="h-3 w-3" strokeWidth={1.5} /> Hilarity Knob
            </span>
            <span className="tabular-nums text-zinc-500">—</span>
          </div>
          <div className="pointer-events-none">
            <Slider min={0} max={11} step={1} value={[0]} disabled />
          </div>
          <div className="text-[10px] text-zinc-500">Coming soon.</div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span>Deadzone</span>
            <span className="tabular-nums text-zinc-400">{settings.encoderDeadzoneMs}ms</span>
          </div>
          <Slider
            min={0}
            max={120}
            step={5}
            value={[settings.encoderDeadzoneMs]}
            onValueChange={([v]) => upd("encoderDeadzoneMs", v)}
          />
          <div className="text-[10px] text-zinc-500">
            Ignore encoder ticks arriving faster than this. Filters jitter.
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span>Repeat threshold</span>
            <span className="tabular-nums text-zinc-400">
              {settings.encoderRepeatThresholdMs}ms
            </span>
          </div>
          <Slider
            min={60}
            max={500}
            step={10}
            value={[settings.encoderRepeatThresholdMs]}
            onValueChange={([v]) => upd("encoderRepeatThresholdMs", v)}
          />
          <div className="text-[10px] text-zinc-500">
            Ticks within this window count as a burst and use the smooth ramp step.
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.showHeadings}
          onChange={(e) => upd("showHeadings", e.target.checked)}
        />
        <span>
          Show block headings
          <span className="block text-[10px] text-zinc-500">
            Renders the rundown title (e.g. "Block 1") above each block in Edit and Prompt mode.
          </span>
        </span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.snapToCursor}
          onChange={(e) => upd("snapToCursor", e.target.checked)}
        />
        <span>
          Sync Extended Display to Edit Cursor
          <span className="block text-[10px] text-zinc-500">
            Centers the line you're editing on the eyeline of all client displays.
          </span>
        </span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.showRuler}
          onChange={(e) => upd("showRuler", e.target.checked)}
        />
        <span>
          Show margin ruler (Edit Mode)
          <span className="block text-[10px] text-zinc-500">
            Drag the blue handles to set the text column width.
          </span>
        </span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.rulerSnap}
          disabled={!settings.showRuler}
          onChange={(e) => upd("rulerSnap", e.target.checked)}
        />
        <span>
          Snap ruler to tick marks
          <span className="block text-[10px] text-zinc-500">
            Margin handles land on the 5% ticks. Hold Alt while dragging to snap freely.
          </span>
        </span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.showAnnotateButton}
          onChange={(e) => upd("showAnnotateButton", e.target.checked)}
        />
        <span>
          Show annotate button
          <span className="block text-[10px] text-zinc-500">
            Hides the floating pencil at the bottom of the screen.
          </span>
        </span>
      </label>

      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span>Horizontal margin</span>
          <span className="tabular-nums text-zinc-400">{settings.marginH}%</span>
        </div>
        <Slider
          min={0}
          max={35}
          step={1}
          value={[settings.marginH]}
          onValueChange={([v]) => upd("marginH", v)}
        />
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span>Vertical margin</span>
          <span className="tabular-nums text-zinc-400">{settings.marginV}vh</span>
        </div>
        <Slider
          min={10}
          max={80}
          step={1}
          value={[settings.marginV]}
          onValueChange={([v]) => upd("marginV", v)}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Alignment</Label>
        <select
          value={settings.align}
          onChange={(e) => upd("align", e.target.value as PrompterSettings["align"])}
          className="w-full h-8 bg-zinc-800 text-white text-xs rounded px-2 border border-zinc-700"
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.allCaps}
          onChange={(e) => upd("allCaps", e.target.checked)}
        />
        Force ALL CAPS
      </label>

      <div className="space-y-1">
        <Label className="text-xs">Custom Font Family</Label>
        <Input
          value={settings.fontFamily}
          onChange={(e) => upd("fontFamily", e.target.value)}
          placeholder="e.g. Helvetica Neue, Courier, Open Sans"
          className="h-8 bg-zinc-800 text-white border-zinc-700"
        />
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span>Line spacing</span>
          <span className="tabular-nums text-zinc-400">{settings.lineHeight.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Slider
            min={0.8}
            max={2.5}
            step={0.05}
            value={[settings.lineHeight]}
            onValueChange={([v]) => upd("lineHeight", v)}
          />
          <Input
            type="number"
            min={0.8}
            max={3}
            step={0.05}
            value={settings.lineHeight}
            onChange={(e) => upd("lineHeight", parseFloat(e.target.value) || 1)}
            className="h-8 w-20 bg-zinc-800 text-white border-zinc-700 text-xs"
          />
        </div>
      </div>

      <div className="pt-2 border-t border-zinc-700 space-y-2">
        <div className="font-semibold text-xs uppercase tracking-wider text-zinc-400">
          Displays (Extended only)
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.flipH}
            onChange={(e) => upd("flipH", e.target.checked)}
          />
          Flip horizontally
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.flipV}
            onChange={(e) => upd("flipV", e.target.checked)}
          />
          Flip vertically
        </label>
      </div>
    </div>
  );
}
