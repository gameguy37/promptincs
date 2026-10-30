import { useEffect, useState } from "react";

type UpdaterEvent =
  | { type: "checking" }
  | { type: "update-available"; info?: { version?: string } }
  | { type: "update-not-available"; info?: unknown }
  | { type: "download-progress"; progress?: { percent?: number } }
  | { type: "update-downloaded"; info?: { version?: string } }
  | { type: "error"; message?: string };

type Status = "idle" | "available" | "downloading" | "ready" | "error";

interface UpdaterBridge {
  onEvent: (cb: (evt: UpdaterEvent) => void) => () => void;
  quitAndInstall: () => void;
  checkNow?: () => void;
}

/**
 * Small non-intrusive badge that surfaces OTA update state from the Electron
 * main process. Renders nothing in the browser or when no update activity is
 * happening.
 */
export function UpdateNotification() {
  const [status, setStatus] = useState<Status>("idle");
  const [percent, setPercent] = useState(0);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const bridge = (window as unknown as { promptinc?: { updater?: UpdaterBridge } })
      .promptinc?.updater;
    if (!bridge?.onEvent) return;
    const off = bridge.onEvent((evt) => {
      switch (evt.type) {
        case "update-available":
          setStatus("downloading");
          setPercent(0);
          setVersion(evt.info?.version ?? null);
          break;
        case "download-progress":
          setStatus("downloading");
          setPercent(Math.round(evt.progress?.percent ?? 0));
          break;
        case "update-downloaded":
          setStatus("ready");
          setVersion(evt.info?.version ?? null);
          break;
        case "error":
          setStatus("error");
          break;
        default:
          break;
      }
    });
    return off;
  }, []);

  if (status === "idle") return null;

  const base =
    "fixed bottom-4 right-4 z-[9999] rounded-md border px-3 py-2 text-xs font-mono shadow-lg select-none";

  if (status === "downloading") {
    return (
      <div className={`${base} border-white/20 bg-black text-white`}>
        <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#0055ff]" />
        Downloading Update{percent ? `… ${percent}%` : "…"}
      </div>
    );
  }

  if (status === "ready") {
    const bridge = (window as unknown as { promptinc?: { updater?: UpdaterBridge } })
      .promptinc?.updater;
    return (
      <button
        type="button"
        onClick={() => bridge?.quitAndInstall()}
        className={`${base} border-[#0055ff] bg-[#0055ff] text-white hover:brightness-110 cursor-pointer`}
      >
        ⟳ Restart to Install Update{version ? ` (v${version})` : ""}
      </button>
    );
  }

  if (status === "error") {
    return (
      <div className={`${base} border-yellow-500/60 bg-black text-yellow-300`}>
        Update check failed
      </div>
    );
  }

  return null;
}