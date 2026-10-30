import { useEffect, useRef } from "react";

/** Commands emitted by the native Electron application menu. */
export type MenuCommand =
  | "preferences"
  | "new-show"
  | "save"
  | "find"
  | "find-replace"
  | "find-next"
  | "find-previous"
  | "transform-upper"
  | "transform-lower"
  | "transform-capitalize"
  | "speech-start"
  | "speech-stop"
  | "toggle-prompt"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "bookmark-add"
  | "bookmark-next"
  | "bookmark-previous"
  | "bookmark-clear";

type Handlers = Partial<Record<MenuCommand, () => void>>;

type Bridge = {
  promptinc?: { onMenuCommand?: (cb: (c: MenuCommand) => void) => () => void };
  electron?: { on?: (channel: string, cb: (c: MenuCommand) => void) => () => void };
};

/**
 * Listens for `menu-command` IPC messages sent from the Electron main process
 * when the user picks an item in the native macOS menu bar. No-op in browsers.
 */
export function useElectronMenu(handlers: Handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as Bridge;
    const run = (command: MenuCommand) => {
      const fn = ref.current[command];
      if (fn) fn();
    };
    const unsubs: Array<() => void> = [];
    if (w.promptinc?.onMenuCommand) unsubs.push(w.promptinc.onMenuCommand(run));
    else if (w.electron?.on) unsubs.push(w.electron.on("menu-command", run));
    return () => unsubs.forEach((u) => u && u());
  }, []);
}
