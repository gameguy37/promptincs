import { useEffect, useRef } from "react";

/** Commands emitted by the native macOS "Format" menu. */
export type FormatCommand =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "size-bigger"
  | "size-smaller"
  | "size-slightly-bigger"
  | "size-slightly-smaller"
  | "document-bigger"
  | "document-smaller"
  | "align-left"
  | "align-center"
  | "align-justify"
  | "align-right"
  | "direction-ltr"
  | "direction-rtl"
  | "baseline-default"
  | "baseline-superscript"
  | "baseline-subscript"
  | "baseline-raise"
  | "baseline-lower"
  | "ligature-default"
  | "ligature-none"
  | "ligature-all"
  | "kern-default"
  | "kern-none"
  | "kern-tighten"
  | "kern-loosen";

type Bridge = {
  promptinc?: { onFormatCommand?: (cb: (c: FormatCommand) => void) => () => void };
  electron?: { on?: (channel: string, cb: (c: FormatCommand) => void) => () => void };
};

/**
 * Listens for `format-command` IPC messages from the Electron main process so
 * the native Apple Format menu can drive the TipTap editor. No-op in browsers.
 */
export function useElectronFormatMenu(run: (command: FormatCommand) => void) {
  const ref = useRef(run);
  ref.current = run;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as Bridge;
    const handler = (command: FormatCommand) => ref.current(command);
    let unsub: (() => void) | undefined;
    if (w.promptinc?.onFormatCommand) unsub = w.promptinc.onFormatCommand(handler);
    else if (w.electron?.on) unsub = w.electron.on("format-command", handler);
    return () => unsub?.();
  }, []);
}
