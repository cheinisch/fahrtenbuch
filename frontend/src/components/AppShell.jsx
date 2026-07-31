import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
} from "@headlessui/react";
import {
  Bars3Icon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import md5 from "blueimp-md5";
import { useMemo } from "react";
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { useAuth } from "../auth/AuthProvider.jsx";

function desktopNavigationClass({ isActive }) {
  return [
    "inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium transition",
    isActive
      ? "border-fb-accent text-fb-text"
      : "border-transparent text-fb-muted hover:border-fb-border hover:text-fb-text",
  ].join(" ");
}

function mobileNavigationClass({ isActive }) {
  return [
    "block border-l-4 py-2 pr-4 pl-3 text-base font-medium transition",
    isActive
      ? "border-fb-accent bg-fb-accent-soft text-fb-accent"
      : "border-transparent text-fb-muted hover:border-fb-border hover:bg-fb-surface hover:text-fb-text",
  ].join(" ");
}

function menuLinkClass({ focus }) {
  return [
    "block w-full px-4 py-2 text-left text-sm transition",
    focus
      ? "bg-fb-surface text-fb-text outline-none"
      : "text-fb-muted",
  ].join(" ");
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const dashboardIsOpen =
    location.pathname === "/";

  const gravatarUrl = useMemo(() => {
    const normalizedEmail = String(user?.email || "")
      .trim()
      .toLowerCase();

    return `https://www.gravatar.com/avatar/${md5(
      normalizedEmail,
    )}?s=128&d=identicon&r=g`;
  }, [user?.email]);

  async function handleLogout() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-fb-surface text-fb-text">
      <Disclosure
        as="nav"
        className="relative bg-fb-main after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-fb-border"
      >
        <div className="w-full px-2 sm:px-6 lg:px-8">
          <div className="relative flex h-16 justify-between">
            <div className="absolute inset-y-0 left-0 flex items-center sm:hidden">
              <DisclosureButton className="group relative inline-flex items-center justify-center rounded-md p-2 text-fb-muted hover:bg-fb-surface hover:text-fb-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent">
                <span className="absolute -inset-0.5" />
                <span className="sr-only">
                  Hauptmenü öffnen
                </span>

                <Bars3Icon
                  aria-hidden="true"
                  className="block size-6 group-data-open:hidden"
                />

                <XMarkIcon
                  aria-hidden="true"
                  className="hidden size-6 group-data-open:block"
                />
              </DisclosureButton>
            </div>

            <div className="flex flex-1 items-center justify-center sm:items-stretch sm:justify-start">
              <NavLink
                to="/"
                className="flex shrink-0 items-center gap-3"
                aria-label="Fahrtenbuch Dashboard"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-fb-accent text-base font-bold text-fb-accent-text">
                  F
                </span>

                <span className="hidden text-lg font-bold tracking-tight text-fb-text lg:block">
                  Fahrtenbuch
                </span>
              </NavLink>

              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                <NavLink
                  to="/"
                  end
                  className={desktopNavigationClass}
                >
                  Dashboard
                </NavLink>
              </div>
            </div>

            <div className="absolute inset-y-0 right-0 flex items-center pr-2 sm:static sm:inset-auto sm:ml-6 sm:pr-0">
              <Menu as="div" className="relative ml-3">
                <MenuButton className="relative flex items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-fb-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent">
                  <span className="absolute -inset-1.5" />
                  <span className="sr-only">
                    Benutzermenü öffnen
                  </span>

                  <img
                    alt=""
                    src={gravatarUrl}
                    className="size-9 rounded-full bg-fb-surface object-cover outline -outline-offset-1 outline-fb-border"
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
                </MenuButton>

                <MenuItems
                  transition
                  anchor="bottom end"
                  className="z-50 mt-2 w-64 origin-top-right rounded-md border border-fb-border bg-fb-main py-1 shadow-xl transition duration-100 ease-out [--anchor-gap:0.5rem] focus:outline-none data-closed:scale-95 data-closed:opacity-0"
                >
                  <div className="border-b border-fb-border px-4 py-3 sm:hidden">
                    <div className="truncate text-sm font-semibold text-fb-text">
                      {user?.username ||
                        user?.displayName ||
                        "Benutzer"}
                    </div>

                    <div className="mt-0.5 truncate text-xs text-fb-muted">
                      {user?.email}
                    </div>
                  </div>

                  <MenuItem>
                    {({ focus }) => (
                      <NavLink
                        to="/profilesettings"
                        className={menuLinkClass({ focus })}
                      >
                        Eigene Einstellungen
                      </NavLink>
                    )}
                  </MenuItem>

                  {user?.role === "admin" && (
                    <MenuItem>
                      {({ focus }) => (
                        <NavLink
                          to="/settings"
                          className={menuLinkClass({
                            focus,
                          })}
                        >
                          Administration
                        </NavLink>
                      )}
                    </MenuItem>
                  )}

                  <div className="my-1 border-t border-fb-border" />

                  <MenuItem>
                    {({ focus }) => (
                      <button
                        type="button"
                        onClick={handleLogout}
                        className={[
                          "block w-full px-4 py-2 text-left text-sm text-fb-danger transition",
                          focus
                            ? "bg-fb-surface outline-none"
                            : "",
                        ].join(" ")}
                      >
                        Abmelden
                      </button>
                    )}
                  </MenuItem>
                </MenuItems>
              </Menu>
            </div>
          </div>
        </div>

        <DisclosurePanel className="sm:hidden">
          <div className="space-y-1 pt-2 pb-4">
            <DisclosureButton
              as={NavLink}
              to="/"
              end
              className={mobileNavigationClass}
            >
              Dashboard
            </DisclosureButton>
          </div>
        </DisclosurePanel>
      </Disclosure>

      <main>
        <div
          className={
            dashboardIsOpen
              ? "w-full px-3 py-3 sm:px-4 sm:py-4"
              : "mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"
          }
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}
