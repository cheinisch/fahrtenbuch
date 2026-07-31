import {
  NavLink,
  Outlet,
  useNavigate,
} from "react-router-dom";

import { useAuth } from "../auth/AuthProvider.jsx";

function DashboardIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="size-5"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="size-5"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="size-5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="size-5"
      aria-hidden="true"
    >
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
    </svg>
  );
}

function NavigationLink({
  to,
  icon,
  children,
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        [
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
          isActive
            ? "bg-fb-accent text-fb-accent-text"
            : "text-fb-muted hover:bg-fb-accent-soft hover:text-fb-text",
        ].join(" ")
      }
    >
      {icon}
      <span>{children}</span>
    </NavLink>
  );
}

export default function AppShell() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  async function handleLogout() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-fb-surface text-fb-text">
      <header className="sticky top-0 z-30 border-b border-fb-border bg-fb-main/95 backdrop-blur lg:hidden">
        <div className="flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-fb-accent font-bold text-fb-accent-text">
              F
            </div>
            <span className="font-semibold">Fahrtenbuch</span>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg p-2 text-fb-muted hover:bg-fb-accent-soft hover:text-fb-text"
            aria-label="Abmelden"
          >
            <LogoutIcon />
          </button>
        </div>

        <nav className="flex gap-2 overflow-x-auto border-t border-fb-border px-4 py-2">
          <NavigationLink to="/" icon={<DashboardIcon />}>
            Dashboard
          </NavigationLink>

          <NavigationLink
            to="/profilesettings"
            icon={<UserIcon />}
          >
            Persönlich
          </NavigationLink>

          {user?.role === "admin" && (
            <NavigationLink
              to="/settings"
              icon={<SettingsIcon />}
            >
              Administration
            </NavigationLink>
          )}
        </nav>
      </header>

      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-fb-border bg-fb-main lg:flex lg:flex-col">
        <div className="flex h-20 items-center gap-3 border-b border-fb-border px-6">
          <div className="flex size-11 items-center justify-center rounded-xl bg-fb-accent text-xl font-bold text-fb-accent-text">
            F
          </div>

          <div>
            <div className="font-bold">Fahrtenbuch</div>
            <div className="text-xs text-fb-muted">
              Selbst gehostet
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-4 py-6">
          <NavigationLink to="/" icon={<DashboardIcon />}>
            Dashboard
          </NavigationLink>

          <NavigationLink
            to="/profilesettings"
            icon={<UserIcon />}
          >
            Persönliche Einstellungen
          </NavigationLink>

          {user?.role === "admin" && (
            <NavigationLink
              to="/settings"
              icon={<SettingsIcon />}
            >
              Administration
            </NavigationLink>
          )}
        </nav>

        <div className="border-t border-fb-border p-4">
          <div className="mb-3 rounded-lg bg-fb-surface px-3 py-3">
            <div className="truncate text-sm font-semibold">
              {user?.displayName || user?.username}
            </div>
            <div className="truncate text-xs text-fb-muted">
              {user?.email}
            </div>
            <div className="mt-2 inline-flex rounded-full bg-fb-accent-soft px-2 py-0.5 text-xs font-medium text-fb-accent">
              {user?.role === "admin"
                ? "Administrator"
                : "Benutzer"}
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-fb-muted transition hover:bg-fb-accent-soft hover:text-fb-text"
          >
            <LogoutIcon />
            Abmelden
          </button>
        </div>
      </aside>

      <main className="lg:pl-72">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
