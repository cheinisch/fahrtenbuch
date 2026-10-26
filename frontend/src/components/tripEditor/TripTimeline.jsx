import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "../../i18n/I18nProvider.jsx";

const MAX_ZOOM = 128;
const ZOOM_STEP = 2;
// Mindestabstand der Zeitmarken in Pixeln
const TICK_SPACING_PX = 110;
// Unterhalb dieser sichtbaren Spanne zeigen die Marken Sekunden
const SECONDS_BELOW_MS = 15 * 60_000;
// Lila: grün ist schon der Startpunkt
const SELECTED = "#a855f7";

/**
 * Zeitachse der Fahrt: wann welche Punkte liegen (gesetzte mit geschätzter Zeit) und wo GPS
 * fehlte. Vergrößerbar (Mausrad, +/−), verschiebbar (ziehen, Bildlaufleiste). Klick wählt einen
 * Punkt, Umschalt+Klick einen Bereich, Strg+Klick ergänzt; ausgewählte Punkte sind grün.
 */
export default function TripTimeline({ points, times, startMs, endMs, gaps, selected, selection, onSelect, formatTime }) {
  const { t } = useI18n();
  const scrollRef = useRef(null);
  const zoomRef = useRef(1);
  const dragRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [viewWidth, setViewWidth] = useState(0);

  const span = endMs - startMs;
  const valid = span > 0;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setViewWidth(element.clientWidth));
    observer.observe(element);
    setViewWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [valid]);

  /** Zoomen und dabei die Stelle unter `anchor` (0–1 der sichtbaren Breite) festhalten. */
  const zoomTo = useCallback((next, anchor = 0.5) => {
    const element = scrollRef.current;
    if (!element) return;
    const previous = zoomRef.current;
    const target = Math.min(MAX_ZOOM, Math.max(1, next));
    if (target === previous) return;
    const width = element.clientWidth;
    const ratio = (element.scrollLeft + anchor * width) / (width * previous);
    zoomRef.current = target;
    setZoom(target);
    requestAnimationFrame(() => {
      element.scrollLeft = ratio * width * target - anchor * width;
    });
  }, []);

  // Mausrad zoomt (an der Mausposition), waagerechtes Scrollen verschiebt.
  // Eigener Listener, weil React-Wheel-Events passiv sind und die Seite sonst mitscrollt.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const onWheel = (event) => {
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const anchor = (event.clientX - rect.left) / rect.width;
      zoomTo(zoomRef.current * (event.deltaY < 0 ? 1.25 : 0.8), anchor);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomTo, valid]);

  // Ausgewählten Punkt im sichtbaren Bereich halten (z. B. beim Durchgehen mit den Pfeiltasten)
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || selected == null || times[selected] == null || zoom === 1) return;
    const x = ((times[selected] - startMs) / span) * element.clientWidth * zoom;
    const margin = element.clientWidth * 0.1;
    if (x < element.scrollLeft + margin || x > element.scrollLeft + element.clientWidth - margin) {
      element.scrollTo({ left: x - element.clientWidth / 2, behavior: "smooth" });
    }
  }, [selected, times, startMs, span, zoom]);

  if (!valid) return null;

  const percent = (time) => Math.min(100, Math.max(0, ((time - startMs) / span) * 100));
  const last = points.length - 1;
  const contentWidth = Math.max(1, viewWidth) * zoom;
  const tickCount = Math.max(2, Math.floor(contentWidth / TICK_SPACING_PX));
  const withSeconds = span / zoom < SECONDS_BELOW_MS;
  const selectedTimes = [...selection].map((index) => times[index]).filter((time) => time != null);
  const rangeFrom = selectedTimes.length > 1 ? Math.min(...selectedTimes) : null;
  const rangeTo = selectedTimes.length > 1 ? Math.max(...selectedTimes) : null;

  // Leere Fläche ziehen verschiebt die vergrößerte Achse
  const onPointerDown = (event) => {
    if (event.target.closest("button") || zoom === 1) return;
    dragRef.current = { x: event.clientX, scroll: scrollRef.current.scrollLeft };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event) => {
    if (!dragRef.current) return;
    scrollRef.current.scrollLeft = dragRef.current.scroll - (event.clientX - dragRef.current.x);
  };
  const onPointerUp = () => { dragRef.current = null; };

  const zoomButton = "inline-flex size-7 items-center justify-center rounded-md border border-fb-border text-sm font-semibold text-fb-text hover:border-fb-accent disabled:opacity-40";

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-fb-border bg-fb-main px-4 pb-3 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <span className="font-semibold">{t("tripEditor.timeline")}</span>
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => zoomTo(zoom / ZOOM_STEP)} disabled={zoom <= 1} aria-label={t("tripEditor.timelineZoomOut")} className={zoomButton}>−</button>
            <button type="button" onClick={() => zoomTo(zoom * ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} aria-label={t("tripEditor.timelineZoomIn")} className={zoomButton}>+</button>
            <button type="button" onClick={() => zoomTo(1)} disabled={zoom <= 1} className={`${zoomButton} w-auto px-2 text-xs`}>{t("tripEditor.timelineZoomReset")}</button>
            {zoom > 1 && <span className="ml-1 text-xs text-fb-muted">{Math.round(zoom * 10) / 10}×</span>}
          </span>
          {selection.size > 1 && (
            <span className="text-xs font-semibold text-[#d8b4fe]">{t("tripEditor.timelineSelected", { count: selection.size })}</span>
          )}
        </span>
        <span className="flex flex-wrap gap-4 text-xs text-fb-muted">
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-[#0ea5e9] bg-white" />{t("tripEditor.legendGps")}</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-white bg-[#0ea5e9]" />{t("tripEditor.legendSet")}</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-white" style={{ background: SELECTED }} />{t("tripEditor.legendSelected")}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-[18px] rounded-sm bg-[repeating-linear-gradient(135deg,#fbbf24_0_3px,transparent_3px_6px)]" />{t("tripEditor.legendGap")}</span>
        </span>
      </div>

      <div
        ref={scrollRef}
        className={`overflow-x-auto overflow-y-hidden ${zoom > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="relative" style={{ width: zoom > 1 ? `${zoom * 100}%` : "100%" }}>
          <div className="relative mx-2 h-[34px]">
            <div className="absolute inset-x-0 top-3.5 h-1.5 rounded-[3px] bg-[#2c2c2c]" />
            {rangeFrom != null && (
              <div className="absolute top-3 h-2.5 rounded-[3px]" style={{ left: `${percent(rangeFrom)}%`, width: `${Math.max(0.2, percent(rangeTo) - percent(rangeFrom))}%`, background: "rgba(168,85,247,0.35)" }} />
            )}
            {gaps.map((gap) => (
              <div key={gap.from} className="absolute top-3 h-2.5 rounded-[3px] bg-[repeating-linear-gradient(135deg,rgba(251,191,36,0.55)_0_4px,transparent_4px_8px)]"
                style={{ left: `${percent(gap.from)}%`, width: `${Math.max(0.2, percent(gap.to) - percent(gap.from))}%` }} />
            ))}
            {points.map((point, index) => {
              if (times[index] == null) return null;
              const isEdge = index === 0 || index === last;
              const isSelected = selection.has(index);
              const isPrimary = index === selected;
              const size = isPrimary ? 16 : isSelected ? 13 : isEdge ? 14 : point.origin === "gps" ? 10 : 12;
              const color = isSelected ? "border-white" : index === 0 ? "bg-[#16a34a] border-white" : index === last ? "bg-[#dc2626] border-white"
                : point.origin === "gps" ? "bg-white border-[#0ea5e9]" : "bg-[#0ea5e9] border-white";
              return (
                <button
                  key={point.key}
                  type="button"
                  tabIndex={isEdge || point.origin !== "gps" || isSelected ? 0 : -1}
                  aria-label={t("tripEditor.timelinePoint", { number: index + 1, time: formatTime(times[index], true) })}
                  aria-pressed={isSelected}
                  title={`#${index + 1} · ${formatTime(times[index], true)}`}
                  onClick={(event) => onSelect(index, { range: event.shiftKey, toggle: event.ctrlKey || event.metaKey })}
                  className={`absolute rounded-full ${isPrimary ? "border-[3px] shadow-[0_0_0_4px_rgba(168,85,247,0.45)]" : "border-2"} ${color}`}
                  style={{
                    left: `calc(${percent(times[index])}% - ${size / 2}px)`,
                    top: `${17 - size / 2}px`,
                    width: size,
                    height: size,
                    zIndex: isPrimary ? 4 : isSelected ? 3 : isEdge ? 2 : 1,
                    ...(isSelected ? { background: SELECTED } : {}),
                  }}
                />
              );
            })}
          </div>
          <div className="relative mx-2 h-4 text-xs text-fb-muted">
            {Array.from({ length: tickCount }, (_, i) => {
              const fraction = i / (tickCount - 1);
              const align = i === 0 ? "translate-x-0" : i === tickCount - 1 ? "-translate-x-full" : "-translate-x-1/2";
              return (
                <span key={i} className={`absolute whitespace-nowrap ${align}`} style={{ left: `${fraction * 100}%` }}>
                  {formatTime(startMs + span * fraction, withSeconds)}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-fb-muted">{t("tripEditor.timelineHint")}</p>
    </div>
  );
}
