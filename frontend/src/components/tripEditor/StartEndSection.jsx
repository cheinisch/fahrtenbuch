import { useI18n } from "../../i18n/I18nProvider.jsx";
import AddressField from "../trips/AddressField.jsx";

const inputClass =
  "h-10 w-full rounded-lg border border-fb-border bg-fb-surface px-2.5 text-sm text-fb-text outline-none [color-scheme:dark] focus:border-fb-accent focus:ring-[3px] focus:ring-fb-accent-soft";
const addressClass =
  "block h-10 w-full rounded-lg border border-fb-border bg-fb-surface px-2.5 text-sm text-fb-text outline-none focus:border-fb-accent focus:ring-[3px] focus:ring-fb-accent-soft";

function placeStatus(t, place, which) {
  if (!place.coordinate) return null;
  return place.saved ? t(`tripEditor.${which}MovedSaved`) : t(`tripEditor.${which}Moved`);
}

/**
 * Start & Ziel als Zeitstrahl: je Endpunkt Tag, Uhrzeit und Adresse. Ein gewählter
 * Vorschlag setzt den ersten bzw. letzten Punkt dorthin (macht die Seite).
 */
export default function StartEndSection({ times, onTime, startPlace, endPlace, onPlace, savedPlaces, accessToken, geocodingEnabled, disabled }) {
  const { t } = useI18n();
  const endpoint = (which) => {
    const place = which === "start" ? startPlace : endPlace;
    const status = placeStatus(t, place, which);
    return (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
          <label className="flex flex-col gap-1 text-xs text-fb-muted">
            {which === "start" ? t("tripEditor.startDate") : t("tripEditor.endDate")}
            <input type="date" required disabled={disabled} min={which === "end" ? times.startDate : undefined}
              value={times[`${which}Date`]} onChange={(event) => onTime(`${which}Date`, event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fb-muted">
            {t("tripEditor.time")}
            <input type="time" required disabled={disabled}
              value={times[`${which}Time`]} onChange={(event) => onTime(`${which}Time`, event.target.value)} className={inputClass} />
          </label>
        </div>
        <div className="text-xs text-fb-muted">
          <AddressField
            id={`editor-${which}-address`}
            label={which === "start" ? t("tripEditor.startAddress") : t("tripEditor.endAddress")}
            value={place}
            onChange={(value) => onPlace(which, value)}
            savedPlaces={savedPlaces}
            accessToken={accessToken}
            geocodingEnabled={geocodingEnabled && !disabled}
            labelClass="text-xs text-fb-muted"
            fieldClass={`mt-1 ${addressClass} ${place.coordinate ? "border-fb-accent ring-[3px] ring-fb-accent-soft" : ""}`}
            hideStatus
          />
        </div>
        {status && <div className="text-xs text-fb-muted">{status}</div>}
      </div>
    );
  };

  return (
    <section aria-labelledby="editor-start-end">
      <h2 id="editor-start-end" className="mb-3 text-xs font-semibold uppercase tracking-[0.06em] text-fb-muted">{t("tripEditor.startEndTitle")}</h2>
      <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-2.5">
        <div className="flex flex-col items-center pt-[22px]">
          <span className="size-3.5 rounded-full border-[3px] border-fb-main bg-[#16a34a] shadow-[0_0_0_2px_#16a34a]" />
          <span className="my-1.5 w-0.5 flex-1 bg-[repeating-linear-gradient(#3a3a3a_0_6px,transparent_6px_10px)]" />
        </div>
        <div className="pb-[18px]">{endpoint("start")}</div>
        <div className="flex flex-col items-center pt-[22px]">
          <span className="size-3.5 rounded-full border-[3px] border-fb-main bg-[#dc2626] shadow-[0_0_0_2px_#dc2626]" />
        </div>
        <div>{endpoint("end")}</div>
      </div>
    </section>
  );
}
