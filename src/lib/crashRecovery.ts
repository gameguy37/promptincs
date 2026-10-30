import localforage from "localforage";
import type { PromptSession } from "@/lib/promptSession";

/**
 * Crash recovery store. `localStorage` caps out around 5MB and throws on
 * long-form shows, so the autosave lives in IndexedDB via localforage.
 */
const store = localforage.createInstance({
  name: "promptin",
  storeName: "crash_recovery",
  description: "Autosaved prompter sessions for power-loss recovery",
});

const KEY = "session";
const DISMISS_KEY = "promptin_recovery_dismissed_at";

export interface RecoverySnapshot extends PromptSession {
  /** Epoch ms of the autosave — used to show "recovered from 12s ago". */
  autosavedAt: number;
}

export async function saveRecoverySnapshot(session: PromptSession): Promise<void> {
  try {
    await store.setItem<RecoverySnapshot>(KEY, { ...session, autosavedAt: Date.now() });
  } catch {
    /* quota or private-mode failure must never interrupt a live show */
  }
}

export async function loadRecoverySnapshot(): Promise<RecoverySnapshot | null> {
  try {
    return (await store.getItem<RecoverySnapshot>(KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function clearRecoverySnapshot(): Promise<void> {
  try {
    await store.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Remember that the operator declined this snapshot so we stop nagging. */
export function markRecoveryDismissed(autosavedAt: number): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(autosavedAt));
  } catch {
    /* ignore */
  }
}

export function wasRecoveryDismissed(autosavedAt: number): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === String(autosavedAt);
  } catch {
    return false;
  }
}