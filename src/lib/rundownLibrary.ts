import type { ScriptBlock } from "@/components/Rundown";

const KEY = "tp.library.v1";
const LAST_KEY = "tp.library.lastOpenedId";

export interface SavedRundown {
  id: string;
  name: string;
  blocks: ScriptBlock[];
  activeId: string | null;
  savedAt: number;
}

function read(): SavedRundown[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function write(items: SavedRundown[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export const rundownLibrary = {
  list(): SavedRundown[] {
    return read().sort((a, b) => b.savedAt - a.savedAt);
  },
  save(name: string, blocks: ScriptBlock[], activeId: string | null, id?: string): SavedRundown {
    const items = read();
    const now = Date.now();
    const cleanName = name.trim() || `Rundown ${new Date(now).toLocaleString()}`;
    if (id) {
      const idx = items.findIndex((r) => r.id === id);
      if (idx >= 0) {
        items[idx] = { ...items[idx], name: cleanName, blocks, activeId, savedAt: now };
        write(items);
        return items[idx];
      }
    }
    // upsert by name (overwrite if same name exists)
    const byName = items.findIndex((r) => r.name.toLowerCase() === cleanName.toLowerCase());
    if (byName >= 0) {
      items[byName] = { ...items[byName], blocks, activeId, savedAt: now };
      write(items);
      return items[byName];
    }
    const newId = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `rd_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const item: SavedRundown = { id: newId, name: cleanName, blocks, activeId, savedAt: now };
    items.unshift(item);
    write(items);
    return item;
  },
  remove(id: string) {
    write(read().filter((r) => r.id !== id));
  },
  get(id: string): SavedRundown | undefined {
    return read().find((r) => r.id === id);
  },
  setLastOpened(id: string | null) {
    try {
      if (id) localStorage.setItem(LAST_KEY, id);
      else localStorage.removeItem(LAST_KEY);
    } catch { /* ignore */ }
  },
  getLastOpened(): SavedRundown | undefined {
    try {
      const id = localStorage.getItem(LAST_KEY);
      if (!id) return undefined;
      return read().find((r) => r.id === id);
    } catch {
      return undefined;
    }
  },
};