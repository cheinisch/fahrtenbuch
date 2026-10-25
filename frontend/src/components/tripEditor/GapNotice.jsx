import { useI18n } from "../../i18n/I18nProvider.jsx";
import { WarnIcon } from "./icons.jsx";

/** Hinweis auf die größte Lücke ohne GPS, mit Dawarich-Import und Sprung auf der Karte. */
export default function GapNotice({ gap, formatTime, routed, dawarichAvailable, dawarichBusy, onDawarich, onJump }) {
  const { t } = useI18n();
  const minutes = Math.round((gap.to - gap.from) / 60_000);
  return (
    <section aria-labelledby="editor-gap" className="flex flex-col gap-2.5 rounded-xl border border-[#5c4410] bg-[#231a06] p-3.5">
      <div className="flex items-start gap-2.5">
        <WarnIcon className="mt-px shrink-0 text-[#fbbf24]" />
        <div>
          <h2 id="editor-gap" className="text-sm font-semibold text-[#fde68a]">{t("tripEditor.gapTitle", { minutes })}</h2>
          <p className="mt-1 text-[13px] leading-[1.45] text-[#d6c7a1]">
            {t("tripEditor.gapText", { from: formatTime(gap.from), to: formatTime(gap.to) })}{" "}
            {routed ? t("tripEditor.gapRouted") : t("tripEditor.gapMorePoints")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-7">
        {dawarichAvailable && (
          <button type="button" onClick={onDawarich} disabled={dawarichBusy}
            className="min-h-9 rounded-lg border border-[#5c4410] bg-[#3a2a06] px-3 text-[13px] font-semibold text-[#fde68a] disabled:opacity-60">
            {dawarichBusy ? t("tripEditor.dawarichBusy") : t("tripEditor.dawarich")}
          </button>
        )}
        <button type="button" onClick={onJump} className="min-h-9 rounded-lg px-3 text-[13px] text-[#d6c7a1] hover:text-[#fde68a]">
          {t("tripEditor.jumpToGap")}
        </button>
      </div>
    </section>
  );
}
