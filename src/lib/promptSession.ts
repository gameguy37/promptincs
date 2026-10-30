import type { ScriptBlock } from "@/components/Rundown";

/** Everything needed to restore an operator's workspace byte-for-byte. */
export interface PromptSession {
  /** File format marker + version so future readers can migrate safely. */
  format: "promptin-quick-session";
  version: 1;
  savedAt: string;
  name: string;
  /** Rich-text script (TipTap HTML per block, same shape the editor uses). */
  blocks: ScriptBlock[];
  activeId: string | null;
  /** Full prompter settings: colors, margins, typography, flips, encoder. */
  settings: Record<string, unknown>;
  /** Scroll speed the show was running at. */
  speed: number;
  scrollY: number;
  textColor: string;
  highlightColor: string;
  /** Persistent annotation layer, if any. */
  annotations?: unknown[];
}

export function buildPromptSession(
  input: Omit<PromptSession, "format" | "version" | "savedAt">,
): PromptSession {
  return {
    format: "promptin-quick-session",
    version: 1,
    savedAt: new Date().toISOString(),
    ...input,
  };
}

function safeName(name: string): string {
  return (name || "session").replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "") || "session";
}

/** Download the session as a single `.prompt` JSON file. */
export function exportPromptFile(session: PromptSession): void {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName(session.name)}.prompt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function isPromptFile(file: File): boolean {
  return /\.prompt$/i.test(file.name);
}

/** Read and validate a `.prompt` file back into a session object. */
export async function importPromptFile(file: File): Promise<PromptSession> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That .prompt file is corrupted (invalid JSON).");
  }
  const session = parsed as PromptSession;
  if (!session || session.format !== "promptin-quick-session" || !Array.isArray(session.blocks)) {
    throw new Error("That file isn't a Promptin' session (.prompt).");
  }
  return session;
}
