import { useI18n } from "../../i18n/I18nProvider.jsx";

const TICKS = 5;

/**
 * Zeitachse der Fahrt: wann welche Punkte liegen (gesetzte mit geschätzter Zeit)
 * und wo GPS fehlte. Ein Klick auf einen Punkt wählt ihn aus.
 */
export default function TripTimeline({ points, times, startMs, endMs, gaps, selected, onSelect, formatTime }) {
  const { t } = useI18n();
  const span = endMs - startMs;
  if (!(span > 0)) return null;
  const percent = (time) => Math.min(100, Math.max(0, ((time - startMs) / span) * 100));
  const last = points.length - 1;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-fb-border bg-fb-main px-4 pb-3.5 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-semibold">{t("tripEditor.timeline")}</span>
        <span className="flex flex-wrap gap-4 text-xs text-fb-muted">
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-[#0ea5e9] bg-white" />{t("tripEditor.legendGps")}</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-white bg-[#0ea5e9]" />{t("tripEditor.legendSet")}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1 w-[18px] rounded-sm bg-[#0ea5e9]" />{t("tripEditor.legendRoute")}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-[18px] rounded-sm bg-[repeating-linear-gradient(135deg,#fbbf24_0_3px,transparent_3px_6px)]" />{t("tripEditor.legendGap")}</span>
        </span>
      </div>
      <div className="relative h-[34px]">
        <div className="absolute inset-x-0 top-3.5 h-1.5 rounded-[3px] bg-[#2c2c2c]" />
        {gaps.map((gap) => (
          <div key={gap.from} className="absolute top-3 h-2.5 rounded-[3px] bg-[repeating-linear-gradient(135deg,rgba(251,191,36,0.55)_0_4px,transparent_4px_8px)]"
            style={{ left: `${percent(gap.from)}%`, width: `${Math.max(0.5, percent(gap.to) - percent(gap.from))}%` }} />
        ))}
        {points.map((point, index) => {
          if (times[index] == null) return null;
          const isEdge = index === 0 || index === last;
          const isSelected = index === selected;
          const size = isSelected ? 16 : isEdge ? 14 : point.origin === "gps" ? 10 : 12;
          const color = index === 0 ? "bg-[#16a34a] border-white" : index === last ? "bg-[#dc2626] border-white"
            : point.origin === "gps" ? "bg-white border-[#0ea5e9]" : "bg-[#0ea5e9] border-white";
          return (
            <button
              key={point.key}
              type="button"
              tabIndex={isEdge || point.origin !== "gps" || isSelected ? 0 : -1}
              aria-label={t("tripEditor.timelinePoint", { number: index + 1, time: formatTime(times[index]) })}
              onClick={() => onSelect(index)}
              className={`absolute rounded-full ${isSelected ? "border-[3px] shadow-[0_0_0_4px_rgba(14,165,233,0.35)]" : "border-2"} ${color}`}
              style={{ left: `calc(${percent(times[index])}% - ${size / 2}px)`, top: `${17 - size / 2}px`, width: size, height: size, zIndex: isSelected ? 3 : isEdge ? 2 : 1 }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-fb-muted">
        {Array.from({ length: TICKS }, (_, i) => <span key={i}>{formatTime(startMs + (span * i) / (TICKS - 1))}</span>)}
      </div>
    </div>
  );
}
