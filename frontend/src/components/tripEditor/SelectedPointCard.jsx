import { useI18n } from "../../i18n/I18nProvider.jsx";
import { CloseIcon } from "./icons.jsx";

/** Ausgewählter Punkt: Herkunft, Zeit, Position, Nähe und Aktionen. */
export default function SelectedPointCard({ index, total, point, timeText, estimated, nearby, editable, onClose, onRemove, onMakeStart, compact = false }) {
  const { t } = useI18n();
  const title = t("tripEditor.pointTitle", {
    number: index + 1,
    total,
    origin: point.origin === "gps" ? t("tripEditor.originGps") : t("tripEditor.originSet"),
  });

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-fb-accent bg-[#0b1f2c] px-3 py-2.5">
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          <div className="truncate text-xs text-fb-muted">{estimated ? "≈ " : ""}{timeText}{nearby ? ` · ${nearby}` : ""}</div>
        </div>
        {editable && (
          <button type="button" onClick={onRemove} className="min-h-10 shrink-0 rounded-lg border border-[#5f2320] bg-[#2a1312] px-3 text-[13px] font-semibold text-[#ff9b94]">
            {t("tripEditor.removeShort")}
          </button>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby="editor-point" className="flex flex-col gap-2.5 rounded-xl border border-fb-accent bg-[#0b1f2c] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="editor-point" className="text-sm font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label={t("tripEditor.deselect")} className="inline-flex size-8 items-center justify-center rounded-lg text-fb-muted hover:text-fb-text">
          <CloseIcon width={16} height={16} />
        </button>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-fb-muted">{t("tripEditor.pointTime")}</dt>
        <dd>
          {estimated ? "≈ " : ""}{timeText}{" "}
          {estimated && <span className="text-fb-muted">{t("tripEditor.distributed")}</span>}
        </dd>
        <dt className="text-fb-muted">{t("tripEditor.pointPosition")}</dt>
        <dd>{point.lat.toFixed(5)}, {point.lon.toFixed(5)}{point.accuracy != null ? ` · ±${Math.round(point.accuracy)} m` : ""}</dd>
        <dt className="text-fb-muted">{t("tripEditor.pointNearby")}</dt>
        <dd className="truncate">{nearby || "–"}</dd>
      </dl>
      {editable && (
        <div className="flex flex-wrap gap-2">
          {index > 0 && (
            <button type="button" onClick={onMakeStart} className="min-h-9 rounded-lg border border-fb-border bg-fb-surface px-3 text-[13px] font-semibold text-fb-text hover:border-fb-accent">
              {t("tripEditor.makeStart")}
            </button>
          )}
          <button type="button" onClick={onRemove} className="min-h-9 rounded-lg border border-[#5f2320] bg-[#2a1312] px-3 text-[13px] font-semibold text-[#ff9b94]">
            {t("tripEditor.removePoint")}
          </button>
        </div>
      )}
    </section>
  );
}
