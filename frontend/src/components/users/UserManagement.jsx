import {
  FunnelIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  createAdminUser,
  deleteAdminUser,
  deleteAdminUserPasskey,
  deleteAdminUserPasskeys,
  disableAdminUserTotp,
  getAdminUser,
  getAdminUsers,
  logoutAdminUserSessions,
  updateAdminUser,
} from "../../api/app.js";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { translate } from "../../i18n/translate.js";
import DeleteUserModal from "./DeleteUserModal.jsx";
import UserEditorModal from "./UserEditorModal.jsx";

const fieldClass =
  "block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft";

function formatDate(value) {
  if (!value) {
    return translate("users.never");
  }

  return new Intl.DateTimeFormat(document.documentElement.lang || "de", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function initialsFor(user) {
  const source =
    user.displayName ||
    user.loginName ||
    user.username ||
    user.email ||
    "?";

  const parts = source
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${
      parts[parts.length - 1][0]
    }`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}

function roleLabel(role) {
  return role === "admin"
    ? translate("users.roleAdmin")
    : translate("users.roleUser");
}

function statusLabel(status) {
  return status === "disabled"
    ? translate("users.statusDisabled")
    : translate("users.statusActive");
}

export default function UserManagement({
  onUsersChanged,
}) {
  const { accessToken, user: currentUser } =
    useAuth();
  const { t } = useI18n();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] =
    useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] =
    useState("");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] =
    useState("");
  const [statusFilter, setStatusFilter] =
    useState("");

  const [editorOpen, setEditorOpen] =
    useState(false);
  const [selectedUser, setSelectedUser] =
    useState(null);
  const [saving, setSaving] =
    useState(false);

  const [securityAction, setSecurityAction] =
    useState("");

  const [deleteTarget, setDeleteTarget] =
    useState(null);
  const [deleting, setDeleting] =
    useState(false);

  async function loadUsers({
    keepMessages = false,
  } = {}) {
    setLoading(true);

    if (!keepMessages) {
      setError("");
    }

    try {
      const result =
        await getAdminUsers(accessToken);

      setUsers(result);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("users.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, [accessToken]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch =
      search.trim().toLowerCase();

    return users.filter((entry) => {
      const matchesSearch =
        !normalizedSearch ||
        [
          entry.displayName,
          entry.loginName,
          entry.username,
          entry.email,
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(normalizedSearch),
        );

      const matchesRole =
        !roleFilter ||
        entry.role === roleFilter;

      const matchesStatus =
        !statusFilter ||
        entry.status === statusFilter;

      return (
        matchesSearch &&
        matchesRole &&
        matchesStatus
      );
    });
  }, [
    roleFilter,
    search,
    statusFilter,
    users,
  ]);

  const userCounts = useMemo(
    () => ({
      total: users.length,
      active: users.filter(
        (entry) => entry.status === "active",
      ).length,
      admins: users.filter(
        (entry) => entry.role === "admin",
      ).length,
    }),
    [users],
  );

  function openCreateModal() {
    setSelectedUser(null);
    setEditorOpen(true);
    setError("");
    setMessage("");
  }

  async function openEditModal(entry) {
    setError("");
    setMessage("");
    setSelectedUser(entry);
    setEditorOpen(true);

    try {
      const details = await getAdminUser(
        accessToken,
        entry.id,
      );

      setSelectedUser((current) =>
        current?.id === entry.id
          ? {
              ...current,
              ...details,
            }
          : current,
      );
    } catch (loadError) {
      setEditorOpen(false);
      setSelectedUser(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("users.detailsFailed"),
      );
    }
  }

  async function handleSave(payload) {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      if (selectedUser) {
        const updated =
          await updateAdminUser(
            accessToken,
            selectedUser.id,
            payload,
          );

        setUsers((current) =>
          current.map((entry) =>
            entry.id === selectedUser.id
              ? {
                  ...entry,
                  ...updated,
                }
              : entry,
          ),
        );

        setMessage(
          t("users.saved", {
            name:
              updated.displayName ||
              updated.loginName ||
              updated.email,
          }),
        );
      } else {
        const created =
          await createAdminUser(
            accessToken,
            payload,
          );

        setUsers((current) => [
          {
            ...created,
            vehicleCount: 0,
            tripCount: 0,
          },
          ...current,
        ]);

        setMessage(
          t("users.created", {
            name:
              created.displayName ||
              created.loginName ||
              created.email,
          }),
        );
      }

      setEditorOpen(false);
      setSelectedUser(null);

      if (onUsersChanged) {
        await onUsersChanged();
      }
    } catch (saveError) {
      throw saveError;
    } finally {
      setSaving(false);
    }
  }

  function applyDetailedUser(updated) {
    setSelectedUser(updated);
    setUsers((current) =>
      current.map((entry) =>
        entry.id === updated.id
          ? {
              ...entry,
              ...updated,
            }
          : entry,
      ),
    );
  }

  async function handleDisableTotp() {
    if (!selectedUser) {
      return;
    }

    setSecurityAction("totp");

    try {
      const updated = await disableAdminUserTotp(
        accessToken,
        selectedUser.id,
      );

      applyDetailedUser(updated);
      setMessage(t("users.totpDisabled"));
    } finally {
      setSecurityAction("");
    }
  }

  async function handleDeletePasskey(passkeyId) {
    if (!selectedUser) {
      return;
    }

    setSecurityAction(`passkey:${passkeyId}`);

    try {
      const updated = await deleteAdminUserPasskey(
        accessToken,
        selectedUser.id,
        passkeyId,
      );

      applyDetailedUser(updated);
      setMessage(t("users.passkeyDeleted"));
    } finally {
      setSecurityAction("");
    }
  }

  async function handleDeleteAllPasskeys() {
    if (!selectedUser) {
      return;
    }

    setSecurityAction("all-passkeys");

    try {
      const updated = await deleteAdminUserPasskeys(
        accessToken,
        selectedUser.id,
      );

      applyDetailedUser(updated);
      setMessage(t("users.passkeysDeleted"));
    } finally {
      setSecurityAction("");
    }
  }

  async function handleLogoutSessions() {
    if (!selectedUser) {
      return;
    }

    setSecurityAction("sessions");

    try {
      const result = await logoutAdminUserSessions(
        accessToken,
        selectedUser.id,
      );

      setMessage(
        t("users.sessionsRevoked", { count: result.revokedSessions }),
      );
    } finally {
      setSecurityAction("");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return;
    }

    setDeleting(true);
    setError("");
    setMessage("");

    try {
      await deleteAdminUser(
        accessToken,
        deleteTarget.id,
      );

      setUsers((current) =>
        current.filter(
          (entry) =>
            entry.id !== deleteTarget.id,
        ),
      );

      setMessage(
        t("users.deleted", {
          name:
            deleteTarget.displayName ||
            deleteTarget.loginName ||
            deleteTarget.email,
        }),
      );

      setDeleteTarget(null);

      if (onUsersChanged) {
        await onUsersChanged();
      }
    } catch (deleteError) {
      throw deleteError;
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded-xl border border-fb-accent bg-fb-accent-soft px-4 py-3 text-sm text-fb-accent">
          {message}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-fb-danger px-4 py-3 text-sm text-fb-danger">
          {error}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm">
          <div className="text-sm text-fb-muted">
            {t("users.countUsers")}
          </div>
          <div className="mt-2 text-3xl font-bold">
            {userCounts.total}
          </div>
        </div>

        <div className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm">
          <div className="text-sm text-fb-muted">
            {t("users.countActive")}
          </div>
          <div className="mt-2 text-3xl font-bold">
            {userCounts.active}
          </div>
        </div>

        <div className="rounded-xl border border-fb-border bg-fb-main p-5 shadow-sm">
          <div className="text-sm text-fb-muted">
            {t("users.countAdmins")}
          </div>
          <div className="mt-2 text-3xl font-bold">
            {userCounts.admins}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-fb-border bg-fb-main shadow-sm">
        <header className="border-b border-fb-border p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-bold">
                {t("users.title")}
              </h2>

              <p className="mt-1 text-sm text-fb-muted">
                {t("users.subtitle")}
              </p>
            </div>

            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-fb-accent px-4 py-2.5 text-sm font-semibold text-fb-accent-text transition hover:bg-fb-accent-secondary"
            >
              <PlusIcon className="size-5" />
              {t("users.new")}
            </button>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
            <label className="relative block">
              <span className="sr-only">
                {t("users.searchLabel")}
              </span>

              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-fb-muted" />

              <input
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder={t("users.searchPlaceholder")}
                className={`${fieldClass} pl-10`}
              />
            </label>

            <label>
              <span className="sr-only">
                {t("users.filterRole")}
              </span>
              <select
                value={roleFilter}
                onChange={(event) =>
                  setRoleFilter(
                    event.target.value,
                  )
                }
                className={fieldClass}
              >
                <option value="">
                  {t("users.allRoles")}
                </option>
                <option value="user">
                  {t("users.countUsers")}
                </option>
                <option value="admin">
                  {t("users.countAdmins")}
                </option>
              </select>
            </label>

            <label>
              <span className="sr-only">
                {t("users.filterStatus")}
              </span>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value,
                  )
                }
                className={fieldClass}
              >
                <option value="">
                  {t("users.allStatuses")}
                </option>
                <option value="active">
                  {t("users.statusActive")}
                </option>
                <option value="disabled">
                  {t("users.statusDisabled")}
                </option>
              </select>
            </label>

            <button
              type="button"
              onClick={() => {
                setSearch("");
                setRoleFilter("");
                setStatusFilter("");
              }}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-fb-border px-3 py-2.5 text-sm font-semibold text-fb-muted transition hover:border-fb-accent hover:text-fb-accent"
            >
              <FunnelIcon className="size-5" />
              {t("users.reset")}
            </button>
          </div>
        </header>

        {loading ? (
          <div className="p-10 text-center text-sm text-fb-muted">
            {t("users.loading")}
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-10 text-center">
            <div className="font-semibold">
              {t("users.emptyTitle")}
            </div>

            <p className="mt-2 text-sm text-fb-muted">
              {t("users.emptyHint")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-fb-border">
              <thead className="bg-fb-surface">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-fb-muted">
                  <th className="px-5 py-3 sm:px-6">
                    {t("users.colUser")}
                  </th>
                  <th className="px-5 py-3">
                    {t("users.colRole")}
                  </th>
                  <th className="px-5 py-3">
                    {t("users.colStatus")}
                  </th>
                  <th className="px-5 py-3">
                    {t("users.colSecurity")}
                  </th>
                  <th className="px-5 py-3">
                    {t("users.colUsage")}
                  </th>
                  <th className="px-5 py-3">
                    {t("users.colLastLogin")}
                  </th>
                  <th className="px-5 py-3 text-right sm:px-6">
                    {t("users.colActions")}
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-fb-border">
                {filteredUsers.map((entry) => {
                  const isCurrentUser =
                    entry.id ===
                    currentUser?.id;

                  return (
                    <tr
                      key={entry.id}
                      className="transition hover:bg-fb-surface/60"
                    >
                      <td className="px-5 py-4 sm:px-6">
                        <div className="flex min-w-64 items-center gap-3">
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fb-accent-soft text-sm font-bold text-fb-accent">
                            {initialsFor(entry)}
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-semibold text-fb-text">
                                {entry.displayName ||
                                  entry.loginName ||
                                  entry.username ||
                                  entry.email}
                              </span>

                              {isCurrentUser && (
                                <span className="rounded-full bg-fb-accent-soft px-2 py-0.5 text-xs font-medium text-fb-accent">
                                  {t("users.you")}
                                </span>
                              )}

                              {entry.forcePasswordChange && (
                                <span className="rounded-full border border-fb-border px-2 py-0.5 text-xs text-fb-muted">
                                  {t("users.passwordChange")}
                                </span>
                              )}
                            </div>

                            <div className="mt-1 truncate text-sm text-fb-muted">
                              {entry.email}
                            </div>

                            <div className="mt-0.5 truncate text-xs text-fb-muted">
                              @
                              {entry.loginName ||
                                entry.username}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={[
                            "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                            entry.role === "admin"
                              ? "bg-fb-accent-soft text-fb-accent"
                              : "border border-fb-border text-fb-muted",
                          ].join(" ")}
                        >
                          {roleLabel(entry.role)}
                        </span>
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={[
                            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                            entry.status === "active"
                              ? "bg-fb-accent-soft text-fb-accent"
                              : "border border-fb-border text-fb-muted",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "size-1.5 rounded-full",
                              entry.status === "active"
                                ? "bg-fb-accent"
                                : "bg-fb-muted",
                            ].join(" ")}
                          />
                          {statusLabel(
                            entry.status,
                          )}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-sm text-fb-muted">
                        <div>
                          {t("users.totpLabel")}: {entry.totpEnabled
                            ? t("users.totpActive")
                            : entry.totpRequired
                              ? t("users.totpRequired")
                              : t("users.totpOff")}
                        </div>
                        <div className="mt-1">
                          {t("users.passkeysLabel")}: {entry.passkeyEnabled
                            ? Number(entry.passkeyCount || 0)
                            : t("users.passkeysDisabled")}
                        </div>
                      </td>

                      <td className="px-5 py-4 text-sm text-fb-muted">
                        <div>
                          {t("users.vehicleCount", { count: Number(entry.vehicleCount || 0) })}
                        </div>
                        <div className="mt-1">
                          {t("users.tripCount", { count: Number(entry.tripCount || 0) })}
                        </div>
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-sm text-fb-muted">
                        {formatDate(
                          entry.lastLoginAt,
                        )}
                      </td>

                      <td className="px-5 py-4 text-right sm:px-6">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              openEditModal(entry)
                            }
                            className="inline-flex items-center gap-2 rounded-lg border border-fb-border px-3 py-2 text-sm font-semibold text-fb-text transition hover:border-fb-accent hover:text-fb-accent"
                          >
                            <PencilSquareIcon className="size-4" />
                            {t("users.edit")}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setDeleteTarget(
                                entry,
                              )
                            }
                            disabled={isCurrentUser}
                            title={
                              isCurrentUser
                                ? t("users.cannotDeleteSelf")
                                : t("users.delete.title")
                            }
                            className="inline-flex items-center justify-center rounded-lg border border-fb-border p-2 text-fb-muted transition hover:border-fb-danger hover:text-fb-danger disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <span className="sr-only">
                              {t("users.delete.title")}
                            </span>
                            <TrashIcon className="size-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <footer className="border-t border-fb-border bg-fb-surface px-5 py-3 text-sm text-fb-muted sm:px-6">
          {t("users.shown", { shown: filteredUsers.length, total: users.length })}
        </footer>
      </section>

      <UserEditorModal
        open={editorOpen}
        user={selectedUser}
        currentUserId={currentUser?.id}
        saving={saving}
        securityAction={securityAction}
        onDisableTotp={handleDisableTotp}
        onDeletePasskey={handleDeletePasskey}
        onDeleteAllPasskeys={handleDeleteAllPasskeys}
        onLogoutSessions={handleLogoutSessions}
        onClose={() => {
          if (!saving) {
            setEditorOpen(false);
            setSelectedUser(null);
          }
        }}
        onSubmit={handleSave}
      />

      <DeleteUserModal
        open={Boolean(deleteTarget)}
        user={deleteTarget}
        deleting={deleting}
        onClose={() => {
          if (!deleting) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={handleDelete}
      />
    </div>
  );
}
