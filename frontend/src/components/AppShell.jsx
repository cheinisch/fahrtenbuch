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
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { useEffect, useState } from "react";

import { getPersonalSettings } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { GRAVATAR_SETTING_EVENT, gravatarUrl } from "../lib/gravatar.js";
import MonthlyOdometerPrompt from "./MonthlyOdometerPrompt.jsx";

const NAV_ITEMS = [
  { to: "/", key: "nav.dashboard", end: true },
  { to: "/vehicles", key: "nav.vehicles" },
  { to: "/costs", key: "nav.costs" },
  { to: "/statistics", key: "nav.statistics" },
  { to: "/export", key: "nav.export" },
  { to: "/compliance", key: "nav.compliance" },
];

function navClass({ isActive }) {
  return [
    "inline-flex min-h-10 items-center rounded-lg px-3.5 text-sm transition",
    isActive
      ? "bg-fb-accent-soft font-semibold text-fb-accent-strong"
      : "font-medium text-fb-muted hover:bg-fb-surface hover:text-fb-text",
  ].join(" ");
}

function mobileNavClass({ isActive }) {
  return [
    "block rounded-lg px-3 py-3 text-base transition",
    isActive
      ? "bg-fb-accent-soft font-semibold text-fb-accent-strong"
      : "font-medium text-fb-muted hover:bg-fb-surface hover:text-fb-text",
  ].join(" ");
}

function menuLinkClass({ focus }) {
  return [
    "block w-full px-4 py-2.5 text-left text-sm transition",
    focus ? "bg-fb-surface text-fb-text outline-none" : "text-fb-muted",
  ].join(" ");
}

function initialsOf(name) {
  const parts = String(name || "").trim().split(/[\s._@-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[1][0] : "")).toUpperCase();
}

/** Gravatar-URL des Nutzers, wenn Instanz und persönliche Einstellung es erlauben. */
function useGravatar(accessToken, email) {
  const [url, setUrl] = useState(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!accessToken) return undefined;
    let cancelled = false;
    getPersonalSettings(accessToken)
      .then((result) => {
        if (!cancelled) setEnabled(result?.settings?.gravatarAvailable !== false && result?.settings?.gravatarEnabled !== false);
      })
      .catch(() => { if (!cancelled) setEnabled(false); });
    const onChange = (event) => setEnabled(Boolean(event.detail));
    window.addEventListener(GRAVATAR_SETTING_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(GRAVATAR_SETTING_EVENT, onChange);
    };
  }, [accessToken]);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setUrl(null);
      return undefined;
    }
    gravatarUrl(email, 72).then((value) => { if (!cancelled) setUrl(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, [enabled, email]);

  return [url, () => setUrl(null)];
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut, accessToken } = useAuth();
  const { t } = useI18n();

  const dashboardIsOpen = location.pathname === "/";
  const displayName = user?.displayName || user?.username || t("shell.user");
  // Bei 404 (kein Gravatar) oder Ladefehler bleiben die Initialen stehen
  const [avatarUrl, clearAvatar] = useGravatar(accessToken, user?.email);

  async function handleLogout() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-fb-surface text-fb-text">
      <Disclosure as="header" className="relative z-40 border-b border-fb-border bg-fb-main">
        <div className="flex h-[4.5rem] items-center gap-7 px-4 sm:px-6">
          <NavLink to="/" className="flex shrink-0 items-center gap-2.5 text-[17px] font-bold text-fb-text" aria-label={`Fahrtenbuch ${t("nav.dashboard")}`}>
            <img src="/fahrtenbuch-logo.svg" alt="" className="size-[34px] rounded-[9px] object-cover" />
            Fahrtenbuch
          </NavLink>

          <nav aria-label={t("shell.mainNavigation")} className="hidden flex-1 items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                {t(item.key)}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <Menu as="div" className="relative">
              <MenuButton className="flex items-center gap-2.5 rounded-full p-1 text-sm font-medium text-fb-text hover:bg-fb-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fb-accent sm:pr-3">
                <span className="sr-only">{t("shell.openUserMenu")}</span>
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="size-9 rounded-full object-cover"
                    onError={clearAvatar}
                  />
                ) : (
                  <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-[#0c4a6e] text-[13px] font-semibold text-white">
                    {initialsOf(displayName)}
                  </span>
                )}
                <span className="hidden max-w-40 truncate sm:block">{displayName}</span>
              </MenuButton>

              <MenuItems
                transition
                anchor="bottom end"
                className="z-50 mt-2 w-64 origin-top-right rounded-xl border border-fb-border bg-fb-main py-1 shadow-xl transition duration-100 ease-out [--anchor-gap:0.5rem] focus:outline-none data-closed:scale-95 data-closed:opacity-0"
              >
                <div className="border-b border-fb-border px-4 py-3">
                  <div className="truncate text-sm font-semibold text-fb-text">{displayName}</div>
                  <div className="mt-0.5 truncate text-xs text-fb-muted">{user?.email}</div>
                </div>
                <MenuItem>
                  {({ focus }) => <NavLink to="/profilesettings" className={menuLinkClass({ focus })}>{t("nav.profile")}</NavLink>}
                </MenuItem>
                {user?.role === "admin" && (
                  <MenuItem>
                    {({ focus }) => <NavLink to="/settings" className={menuLinkClass({ focus })}>{t("nav.settings")}</NavLink>}
                  </MenuItem>
                )}
                <div className="my-1 border-t border-fb-border" />
                <MenuItem>
                  {({ focus }) => (
                    <button type="button" onClick={handleLogout} className={`block w-full px-4 py-2.5 text-left text-sm text-fb-danger transition ${focus ? "bg-fb-surface outline-none" : ""}`}>
                      {t("nav.logout")}
                    </button>
                  )}
                </MenuItem>
              </MenuItems>
            </Menu>

            <DisclosureButton className="group inline-flex size-11 items-center justify-center rounded-lg text-fb-text hover:bg-fb-surface focus-visible:outline-2 focus-visible:outline-fb-accent md:hidden">
              <span className="sr-only">{t("shell.openMenu")}</span>
              <Bars3Icon aria-hidden="true" className="block size-6 group-data-open:hidden" />
              <XMarkIcon aria-hidden="true" className="hidden size-6 group-data-open:block" />
            </DisclosureButton>
          </div>
        </div>

        <DisclosurePanel className="border-t border-fb-border md:hidden">
          <nav aria-label={t("shell.mainNavigation")} className="space-y-1 p-3">
            {NAV_ITEMS.map((item) => (
              <DisclosureButton key={item.to} as={NavLink} to={item.to} end={item.end} className={mobileNavClass}>
                {t(item.key)}
              </DisclosureButton>
            ))}
          </nav>
        </DisclosurePanel>
      </Disclosure>
      <MonthlyOdometerPrompt />

      <main>
        <div className={dashboardIsOpen ? "w-full" : "mx-auto max-w-[1248px] px-6 pb-14 pt-9"}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
