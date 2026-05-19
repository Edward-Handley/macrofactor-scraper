'use client';
import { useEffect, useState, useRef } from "react";
import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { usePalette } from "./context";
import { useActiveDate } from "../../hooks/use-active-date";
import { isoDate } from "../../lib/format";

async function parseDate(input: string): Promise<string | null> {
  try {
    const { parseDate: cd } = await import("chrono-node");
    const result = cd(input);
    if (!result) return null;
    return isoDate(result);
  } catch {
    return null;
  }
}

export function CommandPalette() {
  const { open, setOpen, getAllActions } = usePalette();
  const navigate = useNavigate();
  const { setDate, TODAY } = useActiveDate();
  const [query, setQuery] = useState("");
  const [datePreview, setDatePreview] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setOpen]);

  useEffect(() => {
    if (!open) { setQuery(""); setDatePreview(null); }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) { setDatePreview(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const d = await parseDate(query);
      setDatePreview(d && d <= TODAY ? d : null);
    }, 200);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const actions = getAllActions();

  const NAV_ROUTES = [
    { id: "nav-today",      label: "Today",        path: "/",            group: "Navigate" },
    { id: "nav-morning",    label: "Morning log",   path: "/morning",     group: "Navigate" },
    { id: "nav-evening",    label: "Evening review", path: "/evening",    group: "Navigate" },
    { id: "nav-week",       label: "Week",           path: "/week",       group: "Navigate" },
    { id: "nav-coach",      label: "Coach",          path: "/coach",      group: "Navigate" },
    { id: "nav-health",     label: "Health (Garmin)", path: "/health",    group: "Navigate" },
    { id: "nav-trends",     label: "Trends",         path: "/trends",     group: "Navigate" },
    { id: "nav-workouts",   label: "Workouts",       path: "/workouts",   group: "Navigate" },
    { id: "nav-measures",   label: "Measurements",   path: "/measurements", group: "Navigate" },
    { id: "nav-cut",        label: "Cut Phases",     path: "/cut-phases", group: "Navigate" },
    { id: "nav-data",       label: "Data Health",    path: "/data-health", group: "Navigate" },
    { id: "nav-explore",    label: "Explorer",       path: "/explorer",   group: "Navigate" },
    { id: "nav-settings",   label: "Settings",       path: "/settings",   group: "Navigate" },
  ];

  function handleSelect(handler: () => void) {
    setOpen(false);
    handler();
  }

  function jumpToDate(iso: string) {
    setDate(iso);
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden">
        <Command shouldFilter={true} label="Command palette">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
            <Search size={16} className="text-zinc-500 shrink-0" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search pages, exercises, metrics, dates…"
              className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
              autoFocus
            />
            <kbd className="text-[10px] text-zinc-600 font-mono border border-zinc-700 rounded px-1.5 py-0.5">Esc</kbd>
          </div>

          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-zinc-500">No results.</Command.Empty>

            {/* Date jump from natural language */}
            {datePreview && (
              <Command.Group heading="Jump to date">
                <CommandItem
                  onSelect={() => jumpToDate(datePreview)}
                  label={`Go to ${datePreview}`}
                  description="Set active date"
                />
              </Command.Group>
            )}

            {/* Navigation */}
            <Command.Group heading="Pages">
              {NAV_ROUTES.map((r) => (
                <CommandItem
                  key={r.id}
                  onSelect={() => handleSelect(() => navigate(r.path))}
                  label={r.label}
                />
              ))}
            </Command.Group>

            {/* Page-registered actions */}
            {actions.length > 0 && (() => {
              const grouped = actions.reduce<Record<string, typeof actions>>((acc, a) => {
                const g = a.group ?? "Actions";
                if (!acc[g]) acc[g] = [];
                acc[g].push(a);
                return acc;
              }, {});
              return Object.entries(grouped).map(([group, items]) => (
                <Command.Group key={group} heading={group}>
                  {items.map((a) => (
                    <CommandItem
                      key={a.id}
                      onSelect={() => handleSelect(a.onSelect)}
                      label={a.label}
                    />
                  ))}
                </Command.Group>
              ));
            })()}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function CommandItem({ label, description, onSelect }: {
  label: string; description?: string; onSelect: () => void;
}) {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm cursor-pointer select-none
        text-zinc-300 data-[selected=true]:bg-zinc-800 data-[selected=true]:text-zinc-100 transition-colors"
    >
      <span className="flex-1">{label}</span>
      {description && <span className="text-xs text-zinc-600">{description}</span>}
    </Command.Item>
  );
}
