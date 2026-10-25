import { useI18n } from "../../i18n/I18nProvider.jsx";

/** Kennzahlen: Strecke (mit vorherigem Wert), Dauer mit Ø-Tempo, Punkte nach Herkunft. */
export default function StatCards({ distanceMeters, previousMeters, durationSeconds, gpsCount, setCount, compact = false }) {
  const { t, locale } = useI18n();
  const km = (value) => (value / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const duration = durationSeconds > 0
    ? `${Math.floor(durationSeconds / 3600)}:${String(Math.floor((durationSeconds % 3600) / 60)).padStart(2, "0")} h`
    : "–";
  const speed = durationSeconds > 0 ? Math.round((distanceMeters / 1000) / (durationSeconds / 3600)) : null;
  const card = compact ? "rounded-[10px] border border-[#2c2c2c] bg-fb-surface px-2.5 py-2" : "rounded-[10px] border border-[#2c2c2c] bg-fb-surface p-3";
  const label = compact ? "text-[11px] text-fb-muted" : "text-xs text-fb-muted";
  const value = compact ? "text-[17px] font-bold" : "mt-0.5 text-[22px] font-bold";
  const changed = Math.round(previousMeters) !== Math.round(distanceMeters);

  return (
    <div className="grid grid-cols-3 gap-2">
      <div className={card}>
        <div className={label}>{t("tripEditor.distance")}</div>
        <div className={value}>{km(distanceMeters)} km</div>
        {!compact && (
          <div className={`mt-0.5 text-xs ${changed ? "text-[#86efac]" : "text-fb-muted"}`}>
            {t("tripEditor.previously", { km: km(previousMeters) })}
          </div>
        )}
      </div>
      <div className={card}>
        <div className={label}>{t("tripEditor.duration")}</div>
        <div className={value}>{duration}</div>
        {!compact && <div className="mt-0.5 text-xs text-fb-muted">{speed != null ? t("tripEditor.averageSpeed", { speed }) : " "}</div>}
      </div>
      <div className={card}>
        <div className={label}>{t("tripEditor.points")}</div>
        <div className={value}>{gpsCount + setCount}</div>
        {!compact && <div className="mt-0.5 text-xs text-fb-muted">{t("tripEditor.pointsSplit", { gps: gpsCount, set: setCount })}</div>}
      </div>
    </div>
  );
}
