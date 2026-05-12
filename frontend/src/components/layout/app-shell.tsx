import { Outlet } from "react-router-dom";
import { LogOut, Zap } from "lucide-react";
import { SidebarNav, BottomNav } from "./nav";
import { ThemeToggle } from "./theme-toggle";
import { useIngestStatus } from "../../hooks/use-dashboard";
import { useCutPhases } from "../../hooks/use-daily-log";
import { formatShortDate, isoDate } from "../../lib/format";

function ActivePhaseBadge() {
  const { data } = useCutPhases();
  const today = isoDate();
  const active = data?.phases.find((p) => !p.end_date || p.end_date >= today) ?? null;
  if (!active) return null;
  const daysSince = Math.floor((new Date().getTime() - new Date(active.start_date).getTime()) / 86_400_000) + 1;
  const week = Math.floor(daysSince / 7) + 1;
  return (
    <span className="hidden sm:flex text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
      {active.name} · W{week} D{daysSince}
    </span>
  );
}

function Topbar() {
  const { data: status } = useIngestStatus();
  const lastSync = status?.latest_batch_at
    ? formatShortDate(status.latest_batch_at.slice(0, 10))
    : null;

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center">
          <Zap size={14} className="text-zinc-950" strokeWidth={2.5} />
        </div>
        <span className="font-semibold text-sm text-zinc-100 hidden sm:block">Health</span>
        <ActivePhaseBadge />
      </div>
      <div className="flex items-center gap-2">
        {lastSync && (
          <span className="text-xs text-zinc-500 hidden sm:block">synced {lastSync}</span>
        )}
        <ThemeToggle />
        <form method="post" action="/logout">
          <button
            type="submit"
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title="Logout"
          >
            <LogOut size={17} />
          </button>
        </form>
      </div>
    </header>
  );
}

export function AppShell() {
  return (
    <div className="flex h-screen flex-col md:flex-row overflow-hidden bg-zinc-950">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-52 border-r border-zinc-800 shrink-0 bg-zinc-950">
        <div className="flex flex-col gap-1 px-4 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center">
              <Zap size={14} className="text-zinc-950" strokeWidth={2.5} />
            </div>
            <span className="font-semibold text-sm text-zinc-100">Health</span>
          </div>
          <ActivePhaseBadge />
        </div>
        <SidebarNav />
        <div className="mt-auto p-3 border-t border-zinc-800 flex items-center gap-2">
          <ThemeToggle />
          <form method="post" action="/logout" className="flex-1">
            <button
              type="submit"
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              <LogOut size={14} />
              <span>Logout</span>
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Topbar — mobile only */}
        <div className="md:hidden">
          <Topbar />
        </div>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>

        {/* Bottom nav — mobile only */}
        <div className="md:hidden">
          <BottomNav />
        </div>
      </div>
    </div>
  );
}
