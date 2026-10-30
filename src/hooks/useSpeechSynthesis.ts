import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Thin wrapper around the browser-native Web Speech API (`window.speechSynthesis`).
 *
 * Keeps a React-visible `speaking` flag in sync with the utterance lifecycle so
 * the toolbar can enable/highlight the Stop control only while audio is live.
 * No network, no keys — everything runs on-device.
 */
export function useSpeechSynthesis() {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const cancel = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* no-op */
    }
    utteranceRef.current = null;
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string, rate = 0.95) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
      const clean = text.replace(/\s+/g, " ").trim();
      if (!clean) return false;
      // Always clear any queued speech first — overlapping utterances are the
      // most common cause of "stuck" audio in Chromium.
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = rate;
      u.onend = () => {
        utteranceRef.current = null;
        setSpeaking(false);
      };
      u.onerror = () => {
        utteranceRef.current = null;
        setSpeaking(false);
      };
      utteranceRef.current = u;
      setSpeaking(true);
      window.speechSynthesis.speak(u);
      return true;
    },
    [],
  );

  // Safety: never leave audio running after the component unmounts.
  useEffect(() => () => cancel(), [cancel]);

  return { supported, speaking, speak, cancel };
}
