import { useI18n } from "../../i18n/I18nProvider.jsx";

const arrow = (d) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

/**
 * Eigene (gesetzte) Punkte in Fahrtreihenfolge. Hoch/Runter tauscht einen Punkt mit dem
 * vorherigen bzw. nächsten eigenen Punkt; gemessene GPS-Punkte bleiben, wo sie sind.
 */
export default function OwnPointsList({ points, times, selected, onSelect, onMove, formatTime, editable }) {
  const { t } = useI18n();
  const own = points.map((point, index) => ({ point, index })).filter(({ point }) => point.origin === "set");
  if (!own.length) return null;

  return (
    <section aria-labelledby="editor-own-points" className="flex flex-col gap-2">
      <h2 id="editor-own-points" className="text-xs font-semibold uppercase tracking-[0.06em] text-fb-muted">
        {t("tripEditor.ownPoints", { count: own.length })}
      </h2>
      <ol className="flex flex-col gap-1">
        {own.map(({ point, index }, position) => (
          <li key={point.key}
            className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${index === selected ? "border-fb-accent bg-[#0b1f2c]" : "border-[#2c2c2c] bg-fb-surface"}`}>
            <button type="button" onClick={() => onSelect(index)} className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[#0ea5e9] text-xs font-bold text-white">{position + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{t("tripEditor.pointNumber", { number: index + 1, total: points.length })}</span>
                <span className="block text-xs text-fb-muted">≈ {formatTime(times[index])}</span>
              </span>
            </button>
            {editable && (
              <span className="flex gap-1">
                <button type="button" onClick={() => onMove(index, -1)} disabled={position === 0}
                  aria-label={t("tripEditor.moveEarlier")} title={t("tripEditor.moveEarlier")}
                  className="inline-flex size-9 items-center justify-center rounded-lg border border-fb-border text-fb-text hover:border-fb-accent disabled:opacity-40">
                  {arrow("M12 19V5M6 11l6-6 6 6")}
                </button>
                <button type="button" onClick={() => onMove(index, 1)} disabled={position === own.length - 1}
                  aria-label={t("tripEditor.moveLater")} title={t("tripEditor.moveLater")}
                  className="inline-flex size-9 items-center justify-center rounded-lg border border-fb-border text-fb-text hover:border-fb-accent disabled:opacity-40">
                  {arrow("M12 5v14M6 13l6 6 6-6")}
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="text-xs text-fb-muted">{t("tripEditor.ownPointsHint")}</p>
    </section>
  );
}
