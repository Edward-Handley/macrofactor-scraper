import { NavLink, useSearchParams } from "react-router-dom";
import { Activity, BarChart2, BotMessageSquare, Camera, Database, Dumbbell, HeartPulse, Moon, Ruler, Search, Settings, Sun, Scissors, CalendarCheck } from "lucide-react";
import { cn } from "../../lib/utils";

// Morning = before 14:00, Evening = 14:00+
const isEvening = () => new Date().getHours() >= 14;

const STATIC_NAV_ITEMS = [
  { to: "/",            label: "Today",    Icon: Activity   },
  { to: "/health",      label: "Health",   Icon: HeartPulse },
  { to: "/trends",      label: "Trends",   Icon: BarChart2  },
  { to: "/workouts",    label: "Workouts", Icon: Dumbbell   },
  { to: "/data-health", label: "Data",     Icon: Database   },
  { to: "/explorer",    label: "Explore",  Icon: Search     },
  { to: "/settings",    label: "Settings", Icon: Settings   },
];

function NavItem({ to, label, Icon, end = false }: { to: string; label: string; Icon: React.ElementType; end?: boolean }) {
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

export function SidebarNav() {
  return (
    <nav className="flex flex-col gap-1 p-3">
      <NavItem to="/" label="Today" Icon={Activity} end />
      <LogNavItem />
      <NavItem to="/week" label="Week" Icon={CalendarCheck} />
      <NavItem to="/coach" label="Coach" Icon={BotMessageSquare} />
      <NavItem to="/photos" label="Photos" Icon={Camera} />
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
  return (
    <nav className="flex items-center justify-around px-2 py-1 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <NavItem to="/" label="Today" Icon={Activity} end />
      <LogNavItem />
      <NavItem to="/week" label="Week" Icon={CalendarCheck} />
      <NavItem to="/coach" label="Coach" Icon={BotMessageSquare} />
      <NavItem to="/photos" label="Photos" Icon={Camera} />
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
