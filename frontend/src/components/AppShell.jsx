import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  NavLink,
  Outlet,
  useNavigate,
} from "react-router-dom";
import md5 from "blueimp-md5";

import { useAuth } from "../auth/AuthProvider.jsx";

function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className="size-4"
    >
      <path
        fillRule="evenodd"
        d="M5.22 7.72a.75.75 0 0 1 1.06 0L10 11.44l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.78a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
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
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-5"
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
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-5"
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
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-5"
    >
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
    </svg>
  );
}

function MenuLink({
  to,
  icon,
  children,
  onClick,
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        [
          "flex w-full items-center gap-3 px-4 py-2.5 text-sm transition",
          isActive
            ? "bg-fb-accent-soft font-semibold text-fb-accent"
            : "text-fb-text hover:bg-fb-surface",
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

  const [profileMenuOpen, setProfileMenuOpen] =
    useState(false);

  const profileMenuRef = useRef(null);

  const gravatarUrl = useMemo(() => {
    const normalizedEmail = String(
      user?.email || "",
    )
      .trim()
      .toLowerCase();

    const emailHash = md5(normalizedEmail);

    return `https://www.gravatar.com/avatar/${emailHash}?s=96&d=identicon&r=g`;
  }, [user?.email]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target)
      ) {
        setProfileMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
      }
    }

    document.addEventListener(
      "pointerdown",
      handlePointerDown,
    );

    document.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        handlePointerDown,
      );

      document.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, []);

  async function handleLogout() {
    setProfileMenuOpen(false);
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-fb-surface text-fb-text">
      <header className="sticky top-0 z-40 border-b border-fb-border bg-fb-main/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <NavLink
            to="/"
            className="flex shrink-0 items-center gap-3"
            aria-label="Fahrtenbuch Dashboard"
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-fb-accent text-lg font-bold text-fb-accent-text">
              F
            </span>

            <span className="hidden text-lg font-bold tracking-tight sm:block">
              Fahrtenbuch
            </span>
          </NavLink>

          <nav
            aria-label="Hauptnavigation"
            className="flex min-w-0 flex-1 items-center gap-1"
          >
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                [
                  "rounded-lg px-3 py-2 text-sm font-semibold transition",
                  isActive
                    ? "bg-fb-accent-soft text-fb-accent"
                    : "text-fb-muted hover:bg-fb-surface hover:text-fb-text",
                ].join(" ")
              }
            >
              Dashboard
            </NavLink>
          </nav>

          <div
            ref={profileMenuRef}
            className="relative ml-auto"
          >
            <button
              type="button"
              onClick={() =>
                setProfileMenuOpen((current) => !current)
              }
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-fb-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent"
            >
              <img
                src={gravatarUrl}
                alt=""
                className="size-10 shrink-0 rounded-full border border-fb-border bg-fb-surface object-cover"
                referrerPolicy="no-referrer"
              />

              <span className="hidden min-w-0 sm:block">
                <span className="block max-w-48 truncate text-sm font-semibold text-fb-text">
                  {user?.username ||
                    user?.displayName ||
                    "Benutzer"}
                </span>

                <span className="block max-w-48 truncate text-xs text-fb-muted">
                  {user?.email}
                </span>
              </span>

              <span className="hidden text-fb-muted sm:block">
                <ChevronDownIcon />
              </span>
            </button>

            {profileMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-72 overflow-hidden rounded-xl border border-fb-border bg-fb-main py-2 shadow-xl"
              >
                <div className="border-b border-fb-border px-4 pb-3 pt-2 sm:hidden">
                  <div className="truncate text-sm font-semibold">
                    {user?.username ||
                      user?.displayName ||
                      "Benutzer"}
                  </div>

                  <div className="mt-0.5 truncate text-xs text-fb-muted">
                    {user?.email}
                  </div>
                </div>

                <MenuLink
                  to="/profilesettings"
                  icon={<UserIcon />}
                  onClick={() =>
                    setProfileMenuOpen(false)
                  }
                >
                  Eigene Einstellungen
                </MenuLink>

                {user?.role === "admin" && (
                  <MenuLink
                    to="/settings"
                    icon={<SettingsIcon />}
                    onClick={() =>
                      setProfileMenuOpen(false)
                    }
                  >
                    Administration
                  </MenuLink>
                )}

                <div className="my-2 border-t border-fb-border" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-fb-danger transition hover:bg-fb-surface"
                >
                  <LogoutIcon />
                  <span>Abmelden</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
