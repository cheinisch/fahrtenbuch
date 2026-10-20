import { PlusIcon, TruckIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState } from "react";

import { createVehicle, getVehicles, setDefaultVehicle } from "../../api/app.js";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import VehicleEditorModal from "../vehicles/VehicleEditorModal.jsx";
import { wizardSecondaryButtonClass } from "./WizardFrame.jsx";

// Fahrzeug-Schritt beider Assistenten: vorhandene (auch freigegebene) Fahrzeuge zeigen,
// Standardfahrzeug wählen und ein eigenes Fahrzeug über den bekannten Editor anlegen.
export default function VehicleStep({ onVehiclesChange }) {
  const { accessToken } = useAuth();
  const { t, number } = useI18n();
  const [vehicles, setVehicles] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await getVehicles(accessToken);
    const list = Array.isArray(result) ? result : result?.vehicles || [];
    setVehicles(list);
    onVehiclesChange?.(list);
  }, [accessToken]);

  useEffect(() => {
    load().catch((loadError) => setError(loadError.message));
  }, [load]);

  async function handleCreate(payload) {
    setSaving(true);
    try {
      await createVehicle(accessToken, payload);
      await load();
      setEditorOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault(vehicle) {
    setError("");
    try {
      await setDefaultVehicle(accessToken, vehicle.id);
      await load();
    } catch (defaultError) {
      setError(defaultError.message);
    }
  }

  if (!vehicles && !error) {
    return <div className="text-sm text-fb-muted">{t("common.loading")}</div>;
  }

  return (
    <div className="space-y-4">
      {vehicles?.length > 0 ? (
        <ul className="space-y-2.5">
          {vehicles.map((vehicle) => {
            const shared = vehicle.isOwner === false;
            return (
              <li
                key={vehicle.id}
                className={[
                  "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3",
                  vehicle.isDefault ? "border-fb-accent bg-fb-accent-soft/40" : "border-fb-border",
                ].join(" ")}
              >
                <TruckIcon aria-hidden="true" className="size-6 shrink-0 text-fb-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{vehicle.name}</div>
                  <div className="text-xs text-fb-muted">
                    {shared
                      ? t("vehicles.sharedBy", { user: vehicle.owner?.displayName || vehicle.owner?.username || t("vehicles.otherUser") })
                      : vehicle.odometerKm != null
                        ? `${number(vehicle.odometerKm, { maximumFractionDigits: 0 })} km`
                        : t("wizard.vehicles.own")}
                  </div>
                </div>
                {vehicle.licensePlate && (
                  <span className="rounded border-2 border-fb-text px-2 py-0.5 font-mono text-xs font-semibold uppercase">
                    {vehicle.licensePlate}
                  </span>
                )}
                {shared ? (
                  <span className="rounded-full bg-fb-surface px-2.5 py-0.5 text-xs font-semibold text-fb-muted ring-1 ring-fb-border">
                    {t("wizard.vehicles.sharedBadge")}
                  </span>
                ) : vehicle.isDefault ? (
                  <span className="rounded-full bg-fb-accent px-2.5 py-0.5 text-xs font-semibold text-fb-accent-text">
                    {t("wizard.vehicles.defaultBadge")}
                  </span>
                ) : (
                  <button type="button" onClick={() => makeDefault(vehicle)} className="h-11 rounded-lg px-3 text-sm font-semibold text-fb-accent-strong hover:bg-fb-accent-soft">
                    {t("wizard.vehicles.makeDefault")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-fb-border px-4 py-6 text-center text-sm text-fb-muted">
          {t("wizard.vehicles.none")}
        </div>
      )}

      <button type="button" onClick={() => setEditorOpen(true)} className={wizardSecondaryButtonClass}>
        <PlusIcon aria-hidden="true" className="size-4" />
        {vehicles?.some((vehicle) => vehicle.isOwner !== false) ? t("wizard.vehicles.addAnother") : t("wizard.vehicles.add")}
      </button>

      {error && <div role="alert" className="rounded-lg border border-fb-danger px-4 py-3 text-sm text-fb-danger">{error}</div>}

      <VehicleEditorModal
        open={editorOpen}
        vehicle={null}
        saving={saving}
        onClose={() => setEditorOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}
