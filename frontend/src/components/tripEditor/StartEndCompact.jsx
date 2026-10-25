import { useState } from "react";

import { useI18n } from "../../i18n/I18nProvider.jsx";
import AddressField from "../trips/AddressField.jsx";

const inputClass =
  "h-10 w-full rounded-lg border border-fb-border bg-fb-surface px-2.5 text-sm text-fb-text outline-none [color-scheme:dark] focus:border-fb-accent";

/** Handy: Start und Ziel als kompakte Zeilen; ein Tipp auf die Uhrzeit klappt die Bearbeitung auf. */
export default function StartEndCompact({ times, onTime, startPlace, endPlace, onPlace, savedPlaces, accessToken, geocodingEnabled, disabled }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(null);

  const row = (which) => {
    const place = which === "start" ? startPlace : endPlace;
    const expanded = open === which;
    return (
      <div key={which} className="contents">
        <span className={`size-3 justify-self-center rounded-full ${which === "start" ? "bg-[#16a34a]" : "bg-[#dc2626]"}`} />
        <div className="min-w-0">
          <div className="text-xs text-fb-muted">{which === "start" ? t("tripEditor.start") : t("tripEditor.end")}</div>
          <div className="truncate">{place.address || t("tripEditor.noAddress")}</div>
        </div>
        <button type="button" disabled={disabled} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : which)}
          className="min-h-10 rounded-lg border border-fb-border bg-fb-surface px-2.5 text-[13px] text-fb-text disabled:opacity-50">
          {times[`${which}Time`] || "--:--"}
        </button>
        {expanded && (
          <div className="col-span-3 flex flex-col gap-2 rounded-lg border border-fb-border p-2.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs text-fb-muted">{t("tripEditor.date")}
                <input type="date" value={times[`${which}Date`]} onChange={(event) => onTime(`${which}Date`, event.target.value)} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-fb-muted">{t("tripEditor.time")}
                <input type="time" value={times[`${which}Time`]} onChange={(event) => onTime(`${which}Time`, event.target.value)} className={inputClass} />
              </label>
            </div>
            <div className="text-xs text-fb-muted">
              <AddressField id={`editor-mobile-${which}`} label={t("tripEditor.address")} value={place}
                onChange={(value) => onPlace(which, value)} savedPlaces={savedPlaces} accessToken={accessToken}
                geocodingEnabled={geocodingEnabled} labelClass="text-xs text-fb-muted" fieldClass={`mt-1 ${inputClass}`} hideStatus />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-2">
      {row("start")}
      {row("end")}
    </div>
  );
}
