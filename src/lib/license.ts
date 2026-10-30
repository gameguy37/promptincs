/**
 * Local Trial & License Manager
 *
 * Runs entirely in the browser via `localStorage`. On first launch we start a
 * 14-day free trial. A hardcoded "God Mode" master key unlocks lifetime use
 * for the creator. If the trial expires without a valid key, the caller is
 * expected to render the Trial Expired lock screen and offer the License
 * modal.
 */
import { useEffect, useState } from "react";

export const MASTER_KEY = "PROMPTIN_MASTER_2026";

/** Alphabet used for issued product keys (no ambiguous chars). */
const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Issued keys look like PROMPTIN-XXXX-XXXX-XXXX-C where C is a checksum
 * character derived from the 12 body characters.
 */
export function isValidProductKey(key: string): boolean {
  const parts = key.trim().toUpperCase().split("-");
  if (parts.length !== 5 || parts[0] !== "PROMPTIN") return false;
  const [, a, b, c, check] = parts;
  if (![a, b, c].every((g) => g.length === 4) || check.length !== 1) return false;
  const body = `${a}${b}${c}`;
  let s = 0;
  for (const ch of body) {
    const i = KEY_ALPHABET.indexOf(ch);
    if (i === -1) return false;
    s = (s * 31 + i) % KEY_ALPHABET.length;
  }
  return KEY_ALPHABET[s] === check;
}
const STORAGE_KEY = "promptinc.license.v1";
const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type LicenseStatus = "trial" | "expired" | "lifetime_unlocked";

export interface LicenseState {
  status: LicenseStatus;
  trialStart: number;
  daysLeft: number;
  key: string | null;
}

interface StoredLicense {
  status: LicenseStatus;
  trialStart: number;
  key: string | null;
}

function readStored(): StoredLicense {
  if (typeof window === "undefined") {
    return { status: "trial", trialStart: Date.now(), key: null };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredLicense>;
      if (
        parsed &&
        typeof parsed.trialStart === "number" &&
        (parsed.status === "trial" ||
          parsed.status === "expired" ||
          parsed.status === "lifetime_unlocked")
      ) {
        return {
          status: parsed.status,
          trialStart: parsed.trialStart,
          key: parsed.key ?? null,
        };
      }
    }
  } catch {
    /* corrupt storage — fall through to fresh trial */
  }
  const fresh: StoredLicense = {
    status: "trial",
    trialStart: Date.now(),
    key: null,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  } catch {
    /* ignore */
  }
  return fresh;
}

function writeStored(state: StoredLicense) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function derive(stored: StoredLicense): LicenseState {
  if (stored.status === "lifetime_unlocked") {
    return { ...stored, daysLeft: Number.POSITIVE_INFINITY };
  }
  const elapsed = Date.now() - stored.trialStart;
  const daysLeft = Math.max(0, Math.ceil((TRIAL_DAYS * DAY_MS - elapsed) / DAY_MS));
  const status: LicenseStatus = daysLeft > 0 ? "trial" : "expired";
  return { status, trialStart: stored.trialStart, daysLeft, key: stored.key };
}

export function getLicenseState(): LicenseState {
  return derive(readStored());
}

/**
 * Apply a user-entered product key. The master key permanently unlocks the
 * app; any other value is currently rejected (surface for future keys).
 */
export function applyLicenseKey(key: string): { ok: boolean; state: LicenseState; reason?: string } {
  const trimmed = key.trim();
  if (!trimmed) {
    return { ok: false, state: getLicenseState(), reason: "Enter a product key." };
  }
  if (trimmed === MASTER_KEY || isValidProductKey(trimmed)) {
    const stored: StoredLicense = {
      status: "lifetime_unlocked",
      trialStart: Date.now(),
      key: trimmed,
    };
    writeStored(stored);
    window.dispatchEvent(new CustomEvent("promptinc:license-changed"));
    return { ok: true, state: derive(stored) };
  }
  return {
    ok: false,
    state: getLicenseState(),
    reason: "That product key wasn't recognised.",
  };
}

/** React hook: subscribes to license changes and ticks daily. */
export function useLicense(): LicenseState {
  const [state, setState] = useState<LicenseState>(() => getLicenseState());
  useEffect(() => {
    const refresh = () => setState(getLicenseState());
    refresh();
    // Re-derive once per hour so the countdown ticks even during long sessions.
    const interval = window.setInterval(refresh, 60 * 60 * 1000);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("promptinc:license-changed", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("promptinc:license-changed", refresh);
    };
  }, []);
  return state;
}