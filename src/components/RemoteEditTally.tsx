import { memo, useEffect, useRef, useState } from "react";

/**
 * Broadcast Tally — a zero-layout-shift visual alert that illuminates whenever
 * a remote collaborator edits the script. It listens for the native
 * `remote-script-edit` window event (dispatched from TipTap's onTransaction
 * when a Yjs remote transaction changes the doc), so it never touches the
 * main editor's React state or the GPU scroll loop.
 *
 * Rendered only inside the operator HUD layer (`!displayOnly`) — the talent
 * pop-out viewer and mobile screenshare never mount it.
 */
function RemoteEditTallyImpl() {
  const [lit, setLit] = useState(false);
  const [who, setWho] = useState<string | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onRemoteEdit = (e: Event) => {
      const name = (e as CustomEvent<{ name?: string | null }>).detail?.name;
      // Strip the " - Role" suffix used on cursor labels.
      if (name) setWho(name.split(" - ")[0].trim() || name);
      setLit(true);
      // Reset the idle window on every keystroke burst: the badge only fades
      // 3.5s after the remote user STOPS typing.
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => setLit(false), 3500);
    };
    window.addEventListener("remote-script-edit", onRemoteEdit);
    return () => {
      window.removeEventListener("remote-script-edit", onRemoteEdit);
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-3 z-[9999] -translate-x-1/2 select-none will-change-[opacity]"
      style={{
        opacity: lit ? 1 : 0,
        transition: "opacity 400ms ease",
      }}
    >
      <div
        className="flex items-center gap-2 rounded-full border border-amber-400/70 bg-black/85 px-3.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300 backdrop-blur-sm"
        style={{
          boxShadow: lit
            ? "0 0 12px rgba(251, 191, 36, 0.45), inset 0 0 6px rgba(251, 191, 36, 0.15)"
            : "none",
        }}
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400"
          style={lit ? { animation: "pulse 1s ease-in-out infinite" } : undefined}
        />
        Live Edit Received{who ? ` by ${who}` : ""}
      </div>
    </div>
  );
}

export const RemoteEditTally = memo(RemoteEditTallyImpl);
export default RemoteEditTally;
