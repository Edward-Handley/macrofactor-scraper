import { NavLink } from "react-router-dom";
import { Activity, BarChart2, Database, Dumbbell, Search, Settings } from "lucide-react";
import { cn } from "../../lib/utils";

const NAV_ITEMS = [
  { to: "/",            label: "Today",    Icon: Activity  },
  { to: "/trends",      label: "Trends",   Icon: BarChart2 },
  { to: "/workouts",    label: "Workouts", Icon: Dumbbell  },
  { to: "/data-health", label: "Data",     Icon: Database  },
  { to: "/explorer",    label: "Explore",  Icon: Search    },
  { to: "/settings",    label: "Settings", Icon: Settings  },
];

function NavItem({ to, label, Icon }: typeof NAV_ITEMS[0]) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
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

export function SidebarNav() {
  return (
    <nav className="flex flex-col gap-1 p-3">
      {NAV_ITEMS.map((item) => (
        <NavItem key={item.to} {...item} />
      ))}
    </nav>
  );
}

export function BottomNav() {
  return (
    <nav className="flex items-center justify-around px-2 py-1 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
      {NAV_ITEMS.map((item) => (
        <NavItem key={item.to} {...item} />
      ))}
    </nav>
  );
}
