import { get, set, del, keys } from "idb-keyval";

export interface CoachHistoryEntry {
  id: string;
  date: string;
  kind: string;
  kindLabel: string;
  promptText: string;
  savedAt: string;
  preview: string;
}

const MAX_ENTRIES = 30;

function makeKey(entry: CoachHistoryEntry) {
  return `coach:${entry.savedAt}`;
}

export async function saveCoachEntry(entry: Omit<CoachHistoryEntry, "id" | "savedAt" | "preview">): Promise<CoachHistoryEntry> {
  const savedAt = new Date().toISOString();
  const id = `${entry.date}-${entry.kind}-${Date.now()}`;
  const full: CoachHistoryEntry = {
    ...entry,
    id,
    savedAt,
    preview: entry.promptText.slice(0, 80).replace(/\n/g, " "),
  };
  await set(makeKey(full), full);

  // Prune to MAX_ENTRIES
  const all = await listCoachHistory();
  if (all.length > MAX_ENTRIES) {
    const toDelete = all.slice(MAX_ENTRIES);
    for (const e of toDelete) await del(makeKey(e));
  }

  return full;
}

export async function listCoachHistory(): Promise<CoachHistoryEntry[]> {
  const allKeys = (await keys()).filter((k): k is string => typeof k === "string" && k.startsWith("coach:"));
  const entries: CoachHistoryEntry[] = [];
  for (const k of allKeys) {
    const v = await get<CoachHistoryEntry>(k);
    if (v) entries.push(v);
  }
  return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
