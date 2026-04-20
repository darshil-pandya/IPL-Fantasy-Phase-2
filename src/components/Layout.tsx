import { NavLink, Outlet } from "react-router-dom";
import { useWaiver } from "../context/WaiverContext";
import { isFirebaseConfigured } from "../lib/firebase/client";

type NavItem = { readonly to: string; readonly label: string; readonly end?: boolean };

const navBase: readonly NavItem[] = [
  { to: "/", label: "Home", end: true },
  { to: "/teams", label: "Teams" },
  { to: "/matches", label: "Match Center" },
  { to: "/players", label: "Players" },
  { to: "/waivers", label: "Waivers" },
  { to: "/predictions", label: "Predictions" },
  { to: "/rules", label: "Rules" },
];

function NavItems({ className }: { className?: string }) {
  const { session } = useWaiver();
  const items: NavItem[] = [];
  for (const item of navBase) {
    items.push(item);
    if (
      item.to === "/waivers" &&
      session?.role === "admin" &&
      isFirebaseConfigured()
    ) {
      items.push({ to: "/score-sync", label: "Score sync" });
    }
  }
  return (
    <nav className={className} aria-label="Main">
      <ul className="flex max-w-[100vw] flex-nowrap items-center justify-start gap-1 overflow-x-auto pb-1 md:max-w-none md:flex-wrap md:justify-end md:gap-2 md:overflow-visible md:pb-0">
        {items.map(({ to, label, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end ?? false}
              className={({ isActive }) =>
                [
                  "block shrink-0 rounded-lg px-2 py-2 text-[11px] font-semibold transition-all sm:rounded-xl sm:px-2.5 md:px-3 md:text-sm",
                  isActive ? "app-nav-active" : "app-nav-idle",
                ].join(" ")
              }
            >
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Layout() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-3 pb-24 pt-[max(0.75rem,env(safe-area-inset-top))] font-sans md:px-6 md:pb-8">
      <header className="relative mb-5 flex flex-col gap-4 border-b border-cyan-500/25 pb-5 md:flex-row md:items-end md:justify-between">
        <div className="absolute inset-x-0 -top-3 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent md:-top-4" aria-hidden />
        <div>
          <p className="font-display text-[0.65rem] font-normal uppercase tracking-[0.35em] text-amber-400/90 sm:text-xs">
            Franchise league
          </p>
          <h1 className="font-display text-4xl leading-none tracking-wide text-white drop-shadow-[0_0_24px_rgba(34,211,238,0.25)] md:text-5xl">
            IPL <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-amber-300 bg-clip-text text-transparent">Fantasy</span>
          </h1>
          <p className="mt-1.5 text-xs text-slate-400">High stakes. Live energy. Your squad.</p>
        </div>
        <NavItems className="hidden md:block" />
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-cyan-500/25 bg-slate-950/95 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_32px_rgba(0,0,0,0.45)] backdrop-blur-lg md:hidden">
        <NavItems />
      </div>
    </div>
  );
}
