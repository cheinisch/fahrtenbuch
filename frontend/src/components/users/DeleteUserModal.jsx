import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import {
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  useEffect,
  useState,
} from "react";

import { useI18n } from "../../i18n/I18nProvider.jsx";

export default function DeleteUserModal({
  open,
  user,
  deleting,
  onClose,
  onConfirm,
}) {
  const { t } = useI18n();
  const [confirmation, setConfirmation] =
    useState("");

  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setConfirmation("");
      setError("");
    }
  }, [open, user]);

  async function handleDelete() {
    if (
      confirmation.trim().toLowerCase() !==
      String(user?.email || "")
        .trim()
        .toLowerCase()
    ) {
      setError(
        t("users.delete.mismatch"),
      );
      return;
    }

    setError("");

    try {
      await onConfirm();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : t("users.delete.failed"),
      );
    }
  }

  return (
    <Dialog
      open={open}
      onClose={deleting ? () => {} : onClose}
      className="relative z-[80]"
    >
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 data-closed:opacity-0"
      />

      <div className="fixed inset-0 overflow-y-auto p-4 sm:p-6">
        <div className="flex min-h-full items-center justify-center">
          <DialogPanel
            transition
            className="w-full max-w-lg transform overflow-hidden rounded-2xl border border-fb-border bg-fb-main shadow-2xl transition duration-200 data-closed:scale-95 data-closed:opacity-0"
          >
            <header className="flex items-start justify-between gap-4 border-b border-fb-border px-5 py-4 sm:px-6">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fb-accent-soft text-fb-danger">
                  <ExclamationTriangleIcon className="size-6" />
                </span>

                <div>
                  <DialogTitle className="text-xl font-bold text-fb-text">
                    {t("users.delete.title")}
                  </DialogTitle>

                  <p className="mt-1 text-sm text-fb-muted">
                    {t("users.delete.irreversible")}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                disabled={deleting}
                className="rounded-lg p-2 text-fb-muted transition hover:bg-fb-surface hover:text-fb-text disabled:opacity-50"
              >
                <span className="sr-only">
                  {t("users.closeDialog")}
                </span>
                <XMarkIcon className="size-5" />
              </button>
            </header>

            <div className="space-y-5 p-5 sm:p-6">
              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-fb-danger px-3 py-2 text-sm text-fb-danger"
                >
                  {error}
                </div>
              )}

              <div className="rounded-lg border border-fb-border bg-fb-surface p-4">
                <div className="font-semibold text-fb-text">
                  {user?.displayName ||
                    user?.loginName ||
                    user?.username ||
                    t("users.fallbackName")}
                </div>

                <div className="mt-1 text-sm text-fb-muted">
                  {user?.email}
                </div>

                <div className="mt-3 text-sm text-fb-muted">
                  {t("users.delete.effect")}
                </div>
              </div>

              <label className="block text-sm font-medium text-fb-text">
                {t("users.delete.confirmLabel")}
                <input
                  type="email"
                  value={confirmation}
                  onChange={(event) =>
                    setConfirmation(
                      event.target.value,
                    )
                  }
                  autoComplete="off"
                  className="mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-danger focus:ring-2 focus:ring-fb-accent-soft"
                  placeholder={user?.email}
                />
              </label>
            </div>

            <footer className="flex justify-end gap-3 border-t border-fb-border bg-fb-surface px-5 py-4 sm:px-6">
              <button
                type="button"
                onClick={onClose}
                disabled={deleting}
                className="rounded-lg border border-fb-border px-4 py-2.5 text-sm font-semibold text-fb-text hover:border-fb-accent hover:text-fb-accent disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>

              <button
                type="button"
                onClick={handleDelete}
                disabled={
                  deleting ||
                  !confirmation.trim()
                }
                className="rounded-lg bg-fb-danger px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting
                  ? t("users.delete.deleting")
                  : t("users.delete.confirm")}
              </button>
            </footer>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
