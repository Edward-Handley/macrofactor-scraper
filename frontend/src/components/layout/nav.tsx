import { NavLink, useSearchParams } from "react-router-dom";
import {
  Activity, BarChart2, BotMessageSquare, Camera, Database, Dumbbell,
  HeartPulse, Lightbulb, Moon, Ruler, Search, Settings, Sun, Scissors,
  CalendarCheck, Trophy, ScrollText, Waves, TrendingUp, Target, Gauge,
  Zap,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useAppMode } from "../../hooks/use-app-mode";

const isEvening = () => new Date().getHours() >= 14;

function NavItem({
  to, label, Icon, end = false,
}: {
  to: string;
  label: string;
  Icon: React.ElementType;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium transition-colors",
          isActive
            ? "text-emerald-400 bg-emerald-500/10"
            : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
        )
      }
    >
      <Icon size={20} strokeWidth={1.75} />
      <span className="hidden md:block">{label}</span>
    </NavLink>
  );
}

function PerfNavItem({
  to, label, Icon, end = false,
}: {
  to: string;
  label: string;
  Icon: React.ElementType;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium transition-colors",
          isActive
            ? "text-cyan-400 bg-cyan-500/10"
            : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
        )
      }
    >
      <Icon size={20} strokeWidth={1.75} />
      <span className="hidden md:block">{label}</span>
    </NavLink>
  );
}

function LogNavItem() {
  const evening = isEvening();
  const base = evening ? "/evening" : "/morning";
  const label = evening ? "Evening" : "Morning";
  const Icon = evening ? Moon : Sun;
  const activeColor = evening ? "text-indigo-400 bg-indigo-500/10" : "text-amber-400 bg-amber-500/10";
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get("date");
  const to = dateParam ? `${base}?date=${dateParam}` : base;

  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium transition-colors",
          isActive ? activeColor : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
        )
      }
    >
      <Icon size={20} strokeWidth={1.75} />
      <span className="hidden md:block">{label}</span>
    </NavLink>
  );
}

export function ModeToggle() {
  const { mode, setMode } = useAppMode();
  return (
    <div className="flex rounded-xl bg-zinc-900 border border-zinc-800 p-0.5 gap-0.5">
      <button
        type="button"
        onClick={() => setMode("cut")}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-colors",
          mode === "cut"
            ? "bg-emerald-500/20 text-emerald-400"
            : "text-zinc-500 hover:text-zinc-300"
        )}
      >
        <Scissors size={11} />
        Cut
      </button>
      <button
        type="button"
        onClick={() => setMode("performance")}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-colors",
          mode === "performance"
            ? "bg-cyan-500/20 text-cyan-400"
            : "text-zinc-500 hover:text-zinc-300"
        )}
      >
        <Zap size={11} />
        Perf
      </button>
    </div>
  );
}

export function SidebarNav() {
  const { mode } = useAppMode();

  if (mode === "performance") {
    return (
      <nav className="flex flex-col gap-1 p-3">
        <PerfNavItem to="/performance" label="Dashboard" Icon={Gauge} end />
        <PerfNavItem to="/activities" label="Activities" Icon={Activity} />
        <PerfNavItem to="/swim" label="Swim" Icon={Waves} />
        <PerfNavItem to="/load" label="Load" Icon={TrendingUp} />
        <PerfNavItem to="/goals" label="Goals" Icon={Target} />
        <PerfNavItem to="/coach" label="Coach" Icon={BotMessageSquare} />
        <PerfNavItem to="/health" label="Health" Icon={HeartPulse} />
        <PerfNavItem to="/trends" label="Trends" Icon={BarChart2} />
        <PerfNavItem to="/workouts" label="Gym" Icon={Dumbbell} />
        <PerfNavItem to="/settings" label="Settings" Icon={Settings} />
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-1 p-3">
      <NavItem to="/" label="Today" Icon={Activity} end />
      <LogNavItem />
      <NavItem to="/week" label="Week" Icon={CalendarCheck} />
      <NavItem to="/coach" label="Coach" Icon={BotMessageSquare} />
      <NavItem to="/insights" label="Insights" Icon={Lightbulb} />
      <NavItem to="/photos" label="Photos" Icon={Camera} />
      <NavItem to="/achievements" label="Achievements" Icon={Trophy} />
      <NavItem to="/recaps" label="Recaps" Icon={ScrollText} />
      <NavItem to="/cut-phases" label="Cut" Icon={Scissors} />
      <NavItem to="/measurements" label="Measures" Icon={Ruler} />
      <NavItem to="/health" label="Health" Icon={HeartPulse} />
      <NavItem to="/trends" label="Trends" Icon={BarChart2} />
      <NavItem to="/workouts" label="Workouts" Icon={Dumbbell} />
      <NavItem to="/data-health" label="Data" Icon={Database} />
      <NavItem to="/explorer" label="Explore" Icon={Search} />
      <NavItem to="/settings" label="Settings" Icon={Settings} />
    </nav>
  );
}

export function BottomNav() {
  const { mode } = useAppMode();

  if (mode === "performance") {
    return (
      <nav className="flex items-center justify-around px-2 py-1 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <PerfNavItem to="/performance" label="Dash" Icon={Gauge} end />
        <PerfNavItem to="/activities" label="Activities" Icon={Activity} />
        <PerfNavItem to="/swim" label="Swim" Icon={Waves} />
        <PerfNavItem to="/load" label="Load" Icon={TrendingUp} />
        <PerfNavItem to="/coach" label="Coach" Icon={BotMessageSquare} />
      </nav>
    );
  }

  return (
    <nav className="flex items-center justify-around px-2 py-1 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <NavItem to="/" label="Today" Icon={Activity} end />
      <LogNavItem />
      <NavItem to="/week" label="Week" Icon={CalendarCheck} />
      <NavItem to="/coach" label="Coach" Icon={BotMessageSquare} />
      <NavItem to="/photos" label="Photos" Icon={Camera} />
      <NavItem to="/achievements" label="Achieve" Icon={Trophy} />
      <NavItem to="/recaps" label="Recaps" Icon={ScrollText} />
      <NavItem to="/health" label="Health" Icon={HeartPulse} />
      <NavItem to="/cut-phases" label="Cut" Icon={Scissors} />
      <NavItem to="/measurements" label="Measures" Icon={Ruler} />
      <NavItem to="/trends" label="Trends" Icon={BarChart2} />
      <NavItem to="/workouts" label="Workouts" Icon={Dumbbell} />
      <NavItem to="/data-health" label="Data" Icon={Database} />
      <NavItem to="/settings" label="Settings" Icon={Settings} />
    </nav>
  );
}
