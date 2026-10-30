import { useEffect, useState } from "react";

/**
 * Reactive `navigator.onLine` — updates on `online`/`offline` window events.
 * Server-safe: defaults to `true` during SSR so the offline badge never
 * flashes on hydration for connected users.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // Sync once in case the event fired before mount.
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}