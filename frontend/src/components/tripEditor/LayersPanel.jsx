import { useI18n } from "../../i18n/I18nProvider.jsx";

/** Ebenen der Karte ein-/ausblenden. */
export default function LayersPanel({ layers, onChange, hasMatched }) {
  const { t } = useI18n();
  const item = (key, label, disabled = false) => (
    <label key={key} className={`flex items-center gap-2 text-[#d4d4d4] ${disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" className="m-0" checked={layers[key]} disabled={disabled}
        onChange={(event) => onChange({ ...layers, [key]: event.target.checked })} />
      {label}
    </label>
  );
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-fb-border bg-fb-main px-3 py-2.5 text-xs">
      <span className="font-semibold text-fb-text">{t("tripEditor.layers")}</span>
      {item("route", t("tripEditor.layerRoute"))}
      {item("raw", t("tripEditor.layerRaw"))}
      {item("matched", t("tripEditor.layerMatched"), !hasMatched)}
    </div>
  );
}
