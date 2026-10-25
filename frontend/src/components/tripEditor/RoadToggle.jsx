import { useI18n } from "../../i18n/I18nProvider.jsx";

/** Schalter „Lücken über Straßen füllen“ mit Status der Routenplanung. */
export default function RoadToggle({ checked, disabled, onChange, status, framed = true }) {
  const { t } = useI18n();
  return (
    <label className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 ${framed ? "rounded-[10px] border border-[#2c2c2c] bg-fb-surface px-3 py-2" : ""}`}>
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold">{t("tripEditor.followRoads")}</span>
        <span className="text-xs text-fb-muted">{status}</span>
      </span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition ${checked ? "bg-[#0369a1]" : "bg-[#3a3a3a]"} ${disabled ? "opacity-50" : ""}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={t("tripEditor.followRoads")}
          className="absolute inset-0 m-0 cursor-pointer opacity-0"
        />
        <span className={`absolute top-[3px] size-[18px] rounded-full bg-white transition-all ${checked ? "left-[19px]" : "left-[3px]"}`} />
      </span>
    </label>
  );
}
