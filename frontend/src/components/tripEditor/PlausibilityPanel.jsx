import { useI18n } from "../../i18n/I18nProvider.jsx";

const button = "min-h-10 rounded-lg border border-fb-border px-3 text-[13px] font-semibold hover:border-fb-accent disabled:opacity-50";
const dangerButton = "min-h-10 rounded-lg border border-[#5f2320] bg-[#2a1312] px-3 text-[13px] font-semibold text-[#ff9b94] disabled:opacity-50";

/**
 * Plausibilitätsprüfung der GPS-Punkte: auffällige Punkte werden auf der Karte rot markiert,
 * hier aufgelistet und lassen sich einzeln ansehen oder gemeinsam entfernen (ein Schritt).
 */
export default function PlausibilityPanel({ active, issues, times, formatTime, editable, onCheck, onClose, onSelect, onRemoveAll, compact = false }) {
  const { t } = useI18n();
  const reasonText = (reasons) => reasons.map((reason) => t(`tripEditor.plausibility.reasons.${reason}`)).join(", ");

  if (!active) {
    return (
      <div className={compact ? "" : "flex flex-col gap-1.5"}>
        <button type="button" onClick={onCheck} className={`${button} w-full`}>
          {t("tripEditor.plausibility.check")}
        </button>
        {!compact && <p className="text-xs text-fb-muted">{t("tripEditor.plausibility.hint")}</p>}
      </div>
    );
  }

  return (
    <section aria-labelledby="editor-plausibility" className="flex flex-col gap-2.5 rounded-xl border border-[#5f2320] bg-[#1c1010] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="editor-plausibility" className="text-sm font-semibold">
          {issues.length
            ? t(issues.length === 1 ? "tripEditor.plausibility.foundOne" : "tripEditor.plausibility.found", { count: issues.length })
            : t("tripEditor.plausibility.none")}
        </h2>
        <button type="button" onClick={onClose} className="text-xs font-semibold text-fb-muted hover:text-fb-text">
          {t("tripEditor.plausibility.end")}
        </button>
      </div>

      {issues.length > 0 && (
        <>
          <ul className={`flex flex-col gap-1 overflow-y-auto ${compact ? "max-h-28" : "max-h-56"}`}>
            {issues.map((issue) => (
              <li key={issue.index}>
                <button
                  type="button"
                  onClick={() => onSelect(issue.index)}
                  className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-[#2a1312]"
                >
                  <span aria-hidden="true" className="size-2 shrink-0 self-center rounded-full bg-[#ef4444]" />
                  <span className="shrink-0 font-semibold">#{issue.index + 1}</span>
                  <span className="shrink-0 text-fb-muted">{formatTime(times[issue.index])}</span>
                  <span className="min-w-0 truncate text-[#ff9b94]">{reasonText(issue.reasons)}</span>
                </button>
              </li>
            ))}
          </ul>
          {editable && (
            <button type="button" onClick={onRemoveAll} className={dangerButton}>
              {t("tripEditor.plausibility.removeAll", { count: issues.length })}
            </button>
          )}
          {!compact && <p className="text-xs text-fb-muted">{t("tripEditor.plausibility.note")}</p>}
        </>
      )}
    </section>
  );
}
