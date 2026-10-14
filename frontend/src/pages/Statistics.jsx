import { useEffect, useMemo, useState } from "react";

import { classifyTrip, getLeasingLiveKm, getMonthlyCategoryTrips, getMonthlyOdometerStatistics, getOdometerIntervalStatistics, getOdometerReadings, getVehicles, saveMonthlyOdometerReading } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";
import OdometerReadingLogModal from "../components/OdometerReadingLogModal.jsx";
import PageHeader from "../components/PageHeader.jsx";

const PART_COLORS = {
  businessKm: "bg-sky-600",
  commuteKm: "bg-violet-700 dark:bg-violet-500",
  privateKm: "bg-orange-600",
  unclassifiedKm: "bg-neutral-400",
  unknownKm: "bg-fb-danger",
};

// Reihenfolge von unten nach oben. Privat liegt zwischen Dienstlich (blau) und
// Arbeitsweg (violett), damit die beiden ähnlich wirkenden Farben nie aneinandergrenzen.
// Violett hat im dunklen Thema eine hellere Stufe (Kontrast zur Fläche).
const STACK_SEGMENTS = [
  { key: "businessKm", fill: "fill-sky-600", swatch: "bg-sky-600" },
  { key: "privateKm", fill: "fill-orange-600", swatch: "bg-orange-600" },
  { key: "commuteKm", fill: "fill-violet-700 dark:fill-violet-500", swatch: "bg-violet-700 dark:bg-violet-500" },
  { key: "unclassifiedKm", fill: "fill-neutral-400", swatch: "bg-neutral-400" },
  { key: "unexplainedKm", fill: "", swatch: "" },
];

const labels = {
  businessKm: "Beruflich",
  privateKm: "Privat",
  commuteKm: "Arbeitsweg",
  unclassifiedKm: "Nicht zugeordnet",
  unknownKm: "Unbekannt / nicht erfasst",
};

function km(value) {
  if (value == null) return "–";
  return `${Number(value).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`;
}

function monthLabel(value) {
  const match = /^(\d{4})-(\d{2})/.exec(String(value || ""));
  if (!match) return "–";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return "–";
  const date = new Date(year, month - 1, 1);
  if (!Number.isFinite(date.getTime())) return "–";
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(date);
}


function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultChartRange() {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth() - 3, to.getDate());
  return { from: isoDate(from), to: isoDate(to) };
}

function intervalMonthKey(endDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(endDate || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Gestapelte Monatsbalken: erfasste Kilometer nach Kategorie plus der Teil, der
// laut Ablesung gefahren, aber keiner Fahrt zugeordnet ist (schraffiert).
function StackedMonthChart({ months, monthlyLimitKm = null, selectedMonth, onSelectMonth, labelFor }) {
  const [hovered, setHovered] = useState(null);
  const width = 900;
  const height = 300;
  const pad = { left: 56, right: 16, top: 28, bottom: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, monthlyLimitKm ?? 0, ...months.map((month) => month.total));
  const groupW = innerW / Math.max(1, months.length);
  const barW = Math.min(44, groupW * 0.55);
  const y = (value) => pad.top + innerH - (Math.max(0, value) / max) * innerH;
  const GAP = 2;
  const hoveredIndex = months.findIndex((month) => month.key === hovered);
  const hoveredMonth = hoveredIndex >= 0 ? months[hoveredIndex] : null;
  // Tooltip neben den Balken setzen (rechte Hälfte: links davon), damit er
  // weder den Balken noch die Summen der Nachbarmonate verdeckt.
  const tooltipStyle = (() => {
    if (hoveredIndex < 0) return {};
    const xPct = (pad.left + groupW * hoveredIndex + groupW / 2) / width * 100;
    const offset = (barW / 2 + 10) / width * 100;
    return xPct > 55 ? { right: `${100 - xPct + offset}%` } : { left: `${xPct + offset}%` };
  })();

  return (
    <div className="relative mt-4">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-fb-text/80">
        {STACK_SEGMENTS.map((segment) => (
          <span key={segment.key} className="flex items-center gap-2">
            {segment.key === "unexplainedKm"
              ? <svg aria-hidden="true" className="size-3 rounded-sm"><rect width="12" height="12" fill="url(#unexplained-hatch)" /></svg>
              : <span aria-hidden="true" className={`size-3 rounded-sm ${segment.swatch}`} />}
            {labelFor(segment.key)}
          </span>
        ))}
        {monthlyLimitKm != null && <span className="flex items-center gap-2"><span className="w-5 border-t-2 border-dashed border-amber-500" />Vertragliches Monatslimit: {km(monthlyLimitKm)}</span>}
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[640px]" role="img" aria-label="Kilometer pro Monat nach Kategorie">
          <defs>
            <pattern id="unexplained-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" className="fill-fb-surface" />
              <line x1="0" y1="0" x2="0" y2="6" strokeWidth="2.5" className="stroke-fb-muted" />
            </pattern>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const yy = pad.top + innerH - ratio * innerH;
            return (
              <g key={ratio}>
                <line x1={pad.left} y1={yy} x2={width - pad.right} y2={yy} className={ratio === 0 ? "stroke-fb-muted" : "stroke-fb-border"} strokeWidth="1" />
                <text x={pad.left - 8} y={yy + 4} textAnchor="end" className="fill-fb-muted text-[11px]">{Math.round(max * ratio).toLocaleString("de-DE")}</text>
              </g>
            );
          })}
          {months.map((month, index) => {
            const center = pad.left + groupW * index + groupW / 2;
            let base = 0;
            const segments = STACK_SEGMENTS.map((segment) => {
              const value = month[segment.key] || 0;
              const y0 = y(base);
              base += value;
              const y1 = y(base);
              return { ...segment, value, top: y1, height: Math.max(0, y0 - y1 - GAP) };
            }).filter((segment) => segment.value > 0 && segment.height > 0);
            const isSelected = month.key === selectedMonth;
            const dimmed = hovered && hovered !== month.key;
            return (
              <g
                key={month.key}
                role="button"
                tabIndex={0}
                aria-label={`${month.label}: ${km(month.total)} – Details anzeigen`}
                onClick={() => onSelectMonth(month.key)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectMonth(month.key); } }}
                onMouseEnter={() => setHovered(month.key)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(month.key)}
                onBlur={() => setHovered(null)}
                className="cursor-pointer outline-none"
                style={{ opacity: dimmed ? 0.45 : 1, transition: "opacity 120ms" }}
              >
                <rect x={center - groupW / 2} y={pad.top} width={groupW} height={innerH + pad.bottom} fill="transparent" />
                {segments.map((segment, segmentIndex) => (
                  <rect
                    key={segment.key}
                    x={center - barW / 2}
                    y={segment.top}
                    width={barW}
                    height={segment.height}
                    rx={segmentIndex === segments.length - 1 ? 4 : 1}
                    className={segment.fill}
                    fill={segment.key === "unexplainedKm" ? "url(#unexplained-hatch)" : undefined}
                  />
                ))}
                <text x={center} y={y(month.total) - 8} textAnchor="middle" className="fill-fb-muted text-[11px]">{Math.round(month.total).toLocaleString("de-DE")}</text>
                <text x={center} y={height - 14} textAnchor="middle" className={`text-[12px] ${isSelected ? "fill-fb-accent font-semibold" : "fill-fb-muted"}`}>{month.label}</text>
              </g>
            );
          })}
          {monthlyLimitKm != null && (
            <line x1={pad.left} y1={y(monthlyLimitKm)} x2={width - pad.right} y2={y(monthlyLimitKm)} stroke="#f59e0b" strokeWidth="2" strokeDasharray="7 5" pointerEvents="none" />
          )}
        </svg>
      </div>

      {hoveredMonth && (
        <div style={tooltipStyle} className="pointer-events-none absolute top-6 z-10 w-56 rounded-lg border border-fb-border bg-fb-main p-3 text-xs shadow-lg">
          <div className="font-semibold text-fb-text">{hoveredMonth.label} · {km(hoveredMonth.total)}</div>
          <ul className="mt-2 space-y-1">
            {[...STACK_SEGMENTS].reverse().filter((segment) => hoveredMonth[segment.key] > 0).map((segment) => (
              <li key={segment.key} className="flex items-center justify-between gap-3 text-fb-muted">
                <span className="flex items-center gap-1.5">
                  {segment.key === "unexplainedKm"
                    ? <svg aria-hidden="true" className="size-2.5 rounded-sm"><rect width="10" height="10" fill="url(#unexplained-hatch)" /></svg>
                    : <span aria-hidden="true" className={`size-2.5 rounded-sm ${segment.swatch}`} />}
                  {labelFor(segment.key)}
                </span>
                <span className="font-medium text-fb-text">{km(hoveredMonth[segment.key])}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}

function StatisticsChart({ data, monthlyLimitKm = null }) {
  const width = 900;
  const height = 280;
  const pad = { left: 56, right: 20, top: 24, bottom: 44 };
  const max = Math.max(1, monthlyLimitKm ?? 0, ...data.flatMap((item) => [item.actualKm, item.trackedKm]));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const groupW = data.length ? innerW / data.length : innerW;
  const barW = Math.min(28, groupW * 0.28);
  const y = (value) => pad.top + innerH - (Math.max(0, value) / max) * innerH;

  return (
    <div className="mt-5 overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[720px] w-full" role="img" aria-label="Kilometerstatistik im ausgewählten Zeitraum">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const yy = pad.top + innerH - ratio * innerH;
          return <g key={ratio}><line x1={pad.left} y1={yy} x2={width - pad.right} y2={yy} className="stroke-fb-border" /><text x={pad.left - 8} y={yy + 4} textAnchor="end" className="fill-fb-muted text-[11px]">{Math.round(max * ratio).toLocaleString("de-DE")}</text></g>;
        })}
        {monthlyLimitKm != null && <g>
          <line x1={pad.left} y1={y(monthlyLimitKm)} x2={width - pad.right} y2={y(monthlyLimitKm)} stroke="#f59e0b" strokeWidth="2" strokeDasharray="7 5" />
          <title>{`Vertragliches Monatslimit: ${km(monthlyLimitKm)}`}</title>
        </g>}
        {data.map((item, index) => {
          const center = pad.left + groupW * index + groupW / 2;
          const actualY = y(item.actualKm);
          const trackedY = y(item.trackedKm);
          return <g key={item.label}>
            <rect x={center - barW - 2} y={actualY} width={barW} height={pad.top + innerH - actualY} rx="3" className="fill-fb-accent cursor-help"><title>{`${item.label} – Tatsächlich laut Ablesungen: ${km(item.actualKm)}`}</title></rect>
            <rect x={center + 2} y={trackedY} width={barW} height={pad.top + innerH - trackedY} rx="3" className="fill-fb-muted opacity-70 cursor-help"><title>{`${item.label} – Erfasste Fahrten: ${km(item.trackedKm)}`}</title></rect>
            <text x={center} y={height - 16} textAnchor="middle" className="fill-fb-muted text-[11px]">{item.label}</text>
          </g>;
        })}
      </svg>
      <div className="mt-2 flex flex-wrap justify-center gap-5 text-xs text-fb-muted">
        <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-fb-accent" />Tatsächlich laut Ablesungen</span>
        <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-fb-muted opacity-70" />Erfasste Fahrten</span>
        {monthlyLimitKm != null && <span className="flex items-center gap-2"><span className="w-5 border-t-2 border-dashed border-amber-500" />Vertragliches Monatslimit: {km(monthlyLimitKm)}</span>}
      </div>
    </div>
  );
}

export default function Statistics() {
  const { accessToken } = useAuth();
  const { t } = useI18n();
  const [rows, setRows] = useState([]);
  const [categoryModal, setCategoryModal] = useState(null);
  const [categoryTrips, setCategoryTrips] = useState([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const [classifyingTripId, setClassifyingTripId] = useState(null);
  const [vehicleId, setVehicleId] = useState("");
  const [month, setMonth] = useState("");
  const [error, setError] = useState("");
  const [readings, setReadings] = useState([]);
  const [vehicleDetails, setVehicleDetails] = useState([]);
  const [leasingLive, setLeasingLive] = useState(null);
  // Lokales Datum statt UTC – sonst ist kurz nach Mitternacht noch „gestern“.
  const [entryDate, setEntryDate] = useState(() => isoDate(new Date()));
  const [entryKm, setEntryKm] = useState("");
  const [entryTime, setEntryTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [savingReading, setSavingReading] = useState(false);
  const [message, setMessage] = useState("");
  const [intervals, setIntervals] = useState([]);
  const [readingLogOpen, setReadingLogOpen] = useState(false);
  const [intervalModalOpen, setIntervalModalOpen] = useState(false);
  const [chartYear, setChartYear] = useState(String(new Date().getFullYear()));
  const [showMonthlyLimit, setShowMonthlyLimit] = useState(false);

  async function loadData() {
    try {
      const [result, readingRows, vehicleRows] = await Promise.all([
        getMonthlyOdometerStatistics(accessToken, 18),
        getOdometerReadings(accessToken),
        getVehicles(accessToken),
      ]);
      setRows(result);
      setReadings(readingRows);
      setVehicleDetails(vehicleRows);
      if (!vehicleId) {
        const firstVehicleId = readingRows[0]?.vehicleId || result[0]?.vehicleId || "";
        if (firstVehicleId) {
          setVehicleId(firstVehicleId);
          const newestMonth = result.find((row) => row.vehicleId === firstVehicleId)?.month;
          if (newestMonth) setMonth(newestMonth);
        }
      }
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    loadData();
  }, [accessToken]);

  useEffect(() => {
    if (!vehicleId) {
      setIntervals([]);
      return;
    }
    getOdometerIntervalStatistics(accessToken, vehicleId, `${chartYear}-01-01`, `${Number(chartYear) + 1}-01-01`)
      .then(setIntervals)
      .catch((loadError) => setError(loadError.message));
  }, [accessToken, vehicleId, readings, chartYear]);

  useEffect(() => {
    let cancelled = false;
    setLeasingLive(null);
    if (vehicleId) getLeasingLiveKm(accessToken, vehicleId)
      .then((value) => { if (!cancelled) setLeasingLive(value); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [accessToken, vehicleId, readings, rows]);

  async function saveReading(event) {
    event.preventDefault();
    if (!vehicleId) {
      setError("Bitte ein Fahrzeug auswählen.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      setError("Bitte ein gültiges Ablesedatum auswählen.");
      return;
    }
    const entryMonth = entryDate.slice(0, 7);
    const value = Number(String(entryKm).replace(",", "."));
    if (!Number.isFinite(value) || value < 0) {
      setError("Bitte einen gültigen Kilometerstand eingeben.");
      return;
    }
    setSavingReading(true);
    setError("");
    setMessage("");
    try {
      const readingAt = entryTime ? new Date(`${entryDate}T${entryTime}:00`) : null;
      if (entryTime && (!/^\d{2}:\d{2}$/.test(entryTime) || !Number.isFinite(readingAt.getTime()) || readingAt.getTime() > Date.now())) {
        throw new Error("Bitte eine gültige Ablesezeit angeben, die nicht in der Zukunft liegt.");
      }
      await saveMonthlyOdometerReading(accessToken, vehicleId, entryMonth, value, entryDate, readingAt?.toISOString() || null);
      setMessage(`Kilometerstand vom ${new Intl.DateTimeFormat("de-DE").format(new Date(`${entryDate}T00:00:00`))} wurde gespeichert.`);
      setEntryKm("");
      await loadData();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingReading(false);
    }
  }

  const vehicles = useMemo(() => {
    const vehicleNames = new Map(rows.map((row) => [row.vehicleId, row.vehicleName]));
    return Array.from(new Set([...rows.map((row) => row.vehicleId), ...readings.map((reading) => reading.vehicleId)]))
      .map((id) => [id, vehicleNames.get(id) || readings.find((reading) => reading.vehicleId === id)?.vehicleName || "Fahrzeug"])
      .filter(([, name]) => Boolean(name));
  }, [rows, readings]);

  // Monthly statistics already include the current month, even without an odometer reading.
  const availableMonths = useMemo(() => Array.from(new Set(
    rows
      .filter((row) => row.vehicleId === vehicleId)
      .map((row) => row.month)
      .filter((value) => /^\d{4}-\d{2}$/.test(value)),
  )).sort().reverse(), [rows, vehicleId]);

  const availableYears = useMemo(() => Array.from(new Set(
    availableMonths.map((value) => value.slice(0, 4)),
  )), [availableMonths]);

  const selectedYear = month ? month.slice(0, 4) : (availableYears[0] || "");
  const monthsForYear = useMemo(
    () => availableMonths.filter((value) => value.startsWith(`${selectedYear}-`)),
    [availableMonths, selectedYear],
  );

  const chartYears = useMemo(() => Array.from(new Set(
    readings.filter((reading) => reading.vehicleId === vehicleId)
      .map((reading) => (reading.readingDate || `${reading.month}-01`).slice(0, 4))
      .filter((year) => /^\d{4}$/.test(year)),
  )).sort().reverse(), [readings, vehicleId]);

  useEffect(() => {
    if (chartYears.length && !chartYears.includes(chartYear)) setChartYear(chartYears[0]);
  }, [chartYears, chartYear]);

  const chartData = useMemo(() => {
    const buckets = new Map();
    intervals.forEach((item) => {
      const key = intervalMonthKey(item.endDate);
      if (!key.startsWith(`${chartYear}-`)) return;
      const current = buckets.get(key) || { actualKm: 0, trackedKm: 0 };
      current.actualKm += item.actualKm;
      current.trackedKm += item.trackedKm;
      buckets.set(key, current);
    });
    return Array.from({ length: 12 }, (_, index) => {
      const key = `${chartYear}-${String(index + 1).padStart(2, "0")}`;
      const value = buckets.get(key);
      return value ? { label: monthLabel(key).replace(/\s+\d{4}$/, ""), ...value } : null;
    }).filter(Boolean);
  }, [intervals, chartYear]);

  // Monatswerte für das gestapelte Diagramm aus der Monatsstatistik des Fahrzeugs.
  const stackedMonths = useMemo(() => rows
    .filter((row) => row.vehicleId === vehicleId && String(row.month).startsWith(`${chartYear}-`))
    .sort((a, b) => String(a.month).localeCompare(String(b.month)))
    .map((row) => {
      const businessKm = Number(row.businessKm) || 0;
      const privateKm = Number(row.privateKm) || 0;
      const commuteKm = Number(row.commuteKm) || 0;
      const unclassifiedKm = Number(row.unclassifiedKm) || 0;
      const trackedKm = businessKm + privateKm + commuteKm + unclassifiedKm;
      const unexplainedKm = row.actualKm != null ? Math.max(0, Number(row.actualKm) - trackedKm) : 0;
      return {
        key: row.month,
        label: monthLabel(row.month).replace(/\s+\d{4}$/, ""),
        businessKm, privateKm, commuteKm, unclassifiedKm, unexplainedKm,
        total: trackedKm + unexplainedKm,
      };
    })
    .filter((month) => month.total > 0), [rows, vehicleId, chartYear]);

  const monthlyContractLimit = useMemo(() => {
    const vehicle = vehicleDetails.find((item) => item.id === vehicleId);
    if (!vehicle || !["leasing", "financing"].includes(vehicle.acquisitionType)
      || !vehicle.leaseStartDate || !vehicle.leaseEndDate || !(Number(vehicle.leaseIncludedKm) > 0)) return null;
    const start = new Date(`${vehicle.leaseStartDate.slice(0, 10)}T00:00:00`);
    const end = new Date(`${vehicle.leaseEndDate.slice(0, 10)}T00:00:00`);
    const days = (end - start) / 86400000;
    if (!Number.isFinite(days) || days <= 0) return null;
    return Number(vehicle.leaseIncludedKm) * (365.2425 / 12) / days;
  }, [vehicleDetails, vehicleId]);

  const leasing = useMemo(() => {
    const vehicle = vehicleDetails.find((item) => item.id === vehicleId);
    if (!vehicle || vehicle.acquisitionType === "owned" || !vehicle.leaseStartDate || !vehicle.leaseEndDate || !vehicle.leaseIncludedKm) return null;
    const vehicleReadings = readings.filter((reading) => reading.vehicleId === vehicleId)
      .map((reading) => ({ ...reading, date: new Date(`${reading.readingDate || `${reading.month}-01`}T00:00:00`) }))
      .filter((reading) => Number.isFinite(reading.date.getTime()))
      .sort((a, b) => a.date - b.date);
    if (!vehicleReadings.length) return null;
    const start = new Date(`${vehicle.leaseStartDate.slice(0, 10)}T00:00:00`);
    const end = new Date(`${vehicle.leaseEndDate.slice(0, 10)}T00:00:00`);
    // Every intermediate reading supersedes GPS estimates for its interval.
    // GPS kilometres are added only after the newest actual reading.
    const contractReadings = vehicleReadings.filter((reading) => reading.date <= end && reading.date <= new Date());
    const first = [...contractReadings].reverse().find((reading) => reading.date <= start) || contractReadings[0];
    const last = contractReadings.at(-1);
    if (!first || !last) return null;
    const baselineIsExact = first.date.getTime() === start.getTime();
    const totalDays = Math.max(1, (end - start) / 86400000);
    const liveKm = leasingLive && isoDate(last.date) === String(leasingLive.readingDate).slice(0, 10)
      ? Math.max(0, Number(leasingLive.additionalKm || 0)) : 0;
    const currentOdometerKm = Number(last.odometerKm) + liveKm;
    const effectiveLastDate = liveKm > 0 ? new Date(Math.min(end.getTime(), Date.now())) : last.date;
    const elapsedDays = Math.max(0, Math.min(totalDays, (effectiveLastDate - start) / 86400000));
    const observationStart = first.date < start ? start : first.date;
    const observationDays = Math.max(0, (effectiveLastDate - observationStart) / 86400000);
    const drivenKm = Math.max(0, currentOdometerKm - Number(first.odometerKm));
    const allowedKm = vehicle.leaseIncludedKm * elapsedDays / totalDays;
    // If the contract began before the first reading, the full contractual
    // mileage cannot be determined. Forecast only from the observed period.
    const projectedKm = observationDays > 0 ? drivenKm / observationDays * totalDays : null;
    const deviationKm = projectedKm == null ? null : projectedKm - vehicle.leaseIncludedKm;
    const excessKm = Math.max(0, (deviationKm ?? 0) - Number(vehicle.leaseExcessToleranceKm || 0));
    const shortfallKm = Math.max(0, -(deviationKm ?? 0) - Number(vehicle.leaseShortfallToleranceKm || 0));
    const settlementEur = vehicle.acquisitionType !== "owned"
      ? excessKm * Number(vehicle.leaseExcessRateEur || 0) - shortfallKm * Number(vehicle.leaseShortfallRateEur || 0)
      : null;
    const settlementConfigured = deviationKm != null && (deviationKm >= 0
      ? vehicle.leaseExcessRateEur != null
      : vehicle.leaseShortfallRateEur != null);
    return { vehicle, baselineIsExact, baselineDate: first.date, baselineKm: Number(first.odometerKm), lastReadingKm: Number(last.odometerKm), lastReadingDate: last.date, gpsSinceReadingKm: liveKm, currentOdometerKm, drivenKm, allowedKm, projectedKm, deviationKm, settlementEur, settlementConfigured, elapsedPercent: elapsedDays / totalDays * 100 };
  }, [vehicleDetails, readings, vehicleId, leasingLive]);

  async function openCategory(key) {
    setCategoryModal(key);
    setCategoryTrips([]);
    setCategoryError("");
    if (key === "unknownKm") return;
    const type = { businessKm: "business", privateKm: "private", commuteKm: "commute", unclassifiedKm: "unclassified" }[key];
    if (!type) return;
    setCategoryLoading(true);
    try {
      setCategoryTrips(await getMonthlyCategoryTrips(accessToken, vehicleId, month, type));
    } catch (err) { setCategoryError(err.message); }
    finally { setCategoryLoading(false); }
  }

  async function classifyCategoryTrip(tripId, category) {
    setClassifyingTripId(tripId);
    setCategoryError("");
    try {
      await classifyTrip(accessToken, tripId, category, null, null);
      setCategoryTrips((current) => current.filter((trip) => trip.id !== tripId));
      await loadData();
    } catch (err) {
      setCategoryError(err.message);
    } finally {
      setClassifyingTripId(null);
    }
  }

  function changeVehicle(nextVehicleId) {
    setVehicleId(nextVehicleId);
    setMonth(rows.find((row) => row.vehicleId === nextVehicleId)?.month || "");
  }

  // Jahreskennzahlen für die Kopfzeile: Ablesungen vs. erfasste Fahrten.
  const yearSummary = useMemo(() => {
    if (!chartData.length) return null;
    const actualKm = chartData.reduce((sum, item) => sum + item.actualKm, 0);
    const trackedKm = chartData.reduce((sum, item) => sum + item.trackedKm, 0);
    const yearRows = rows.filter((row) => row.vehicleId === vehicleId && String(row.month).startsWith(`${chartYear}-`));
    const businessKm = yearRows.reduce((sum, row) => sum + (Number(row.businessKm) || 0), 0);
    const classifiedKm = yearRows.reduce((sum, row) => sum + (Number(row.businessKm) || 0) + (Number(row.privateKm) || 0) + (Number(row.commuteKm) || 0), 0);
    return {
      actualKm,
      trackedKm,
      coverage: actualKm > 0 ? Math.min(100, trackedKm / actualKm * 100) : null,
      unexplainedKm: Math.max(0, actualKm - trackedKm),
      businessKm,
      businessShare: classifiedKm > 0 ? businessKm / classifiedKm * 100 : null,
    };
  }, [chartData, rows, vehicleId, chartYear]);

  const percent = (value) => `${Number(value).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
  const selected = rows.find((row) => row.vehicleId === vehicleId && row.month === month) || null;
  // Use recorded trip kilometres as the live baseline until the odometer readings
  // cover the whole month. A zero-km reading interval must not hide recorded trips.
  const total = selected ? Math.max(
    0,
    Number(selected.actualKm) || 0,
    Number(selected.trackedKm) || 0,
  ) : 0;
  const parts = selected ? [
    ["businessKm", selected.businessKm],
    ["privateKm", selected.privateKm],
    ["commuteKm", selected.commuteKm],
    ["unclassifiedKm", selected.unclassifiedKm],
    ["unknownKm", selected.unknownKm],
  ] : [];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("nav.statistics")} title={t("statistics.heading")} subtitle={t("statistics.subtitle")}>
        <label className="text-[13px] font-medium text-fb-muted">
          {t("statistics.vehicle")}
          <select value={vehicleId} onChange={(e) => changeVehicle(e.target.value)} className="mt-1 block h-11 min-w-[220px] rounded-lg border border-fb-border bg-fb-main px-3 text-sm text-fb-text">
            {vehicles.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      </PageHeader>
      {yearSummary && (
        <section aria-label={t("statistics.yearSummary", { year: chartYear })} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-fb-border bg-fb-main p-[18px]">
            <div className="text-[13px] text-fb-muted">{t("statistics.drivenYear", { year: chartYear })}</div>
            <div className="mt-1.5 text-[28px] font-bold leading-tight">{km(yearSummary.actualKm)}</div>
            <div className="mt-1 text-xs text-fb-muted">{t("statistics.byReadings")}</div>
          </div>
          <div className="rounded-xl border border-fb-border bg-fb-main p-[18px]">
            <div className="text-[13px] text-fb-muted">{t("statistics.tracked")}</div>
            <div className="mt-1.5 text-[28px] font-bold leading-tight">{km(yearSummary.trackedKm)}</div>
            <div className="mt-1 text-xs text-fb-muted">{yearSummary.coverage != null ? t("statistics.coverage", { value: percent(yearSummary.coverage) }) : "–"}</div>
          </div>
          <div className="rounded-xl border border-fb-border bg-fb-main p-[18px]">
            <div className="text-[13px] text-fb-muted">{t("statistics.businessShare")}</div>
            <div className="mt-1.5 text-[28px] font-bold leading-tight">{yearSummary.businessShare != null ? percent(yearSummary.businessShare) : "–"}</div>
            <div className="mt-1 text-xs text-fb-muted">{km(yearSummary.businessKm)}</div>
          </div>
          <div className={`rounded-xl border bg-fb-main p-[18px] ${yearSummary.unexplainedKm > 0 ? "border-fb-danger/40" : "border-fb-border"}`}>
            <div className="text-[13px] text-fb-muted">{t("statistics.unexplained")}</div>
            <div className={`mt-1.5 text-3xl font-bold ${yearSummary.unexplainedKm > 0 ? "text-fb-danger" : ""}`}>{km(yearSummary.unexplainedKm)}</div>
            <div className="mt-1 text-xs text-fb-muted">{t("statistics.unexplainedHint")}</div>
          </div>
        </section>
      )}
      {error && <div className="rounded-lg border border-fb-danger p-4 text-sm text-fb-danger">{error}</div>}
      {message && <div className="rounded-lg border border-fb-accent bg-fb-accent-soft p-4 text-sm text-fb-accent">{message}</div>}
      <section className="rounded-xl border border-fb-border bg-fb-main p-[22px]">
        <h2 className="text-lg font-bold">Kilometerstand nachtragen</h2>
        <p className="mt-1 text-sm text-fb-muted">Kilometerstände können für beliebige Tage nachgetragen werden. Mehrere Zwischenablesungen pro Monat sind möglich; die Reihenfolge zu vorherigen und folgenden Messwerten wird geprüft.</p>
        <form onSubmit={saveReading} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-[1_1_160px] flex-col gap-1 text-[13px] font-medium text-fb-muted">Ablesedatum<input type="date" value={entryDate} max={isoDate(new Date())} onChange={(e) => setEntryDate(e.target.value)} className="h-11 rounded-lg border border-fb-border bg-fb-surface px-3 text-sm font-normal text-fb-text" /></label>
          <label className="flex flex-[1_1_120px] flex-col gap-1 text-[13px] font-medium text-fb-muted">Ablesezeit<input type="time" value={entryTime} onChange={(e) => setEntryTime(e.target.value)} className="h-11 rounded-lg border border-fb-border bg-fb-surface px-3 text-sm font-normal text-fb-text" /></label>
          <label className="flex flex-[2_1_200px] flex-col gap-1 text-[13px] font-medium text-fb-muted">Kilometerstand<span className="flex items-center gap-2"><input inputMode="decimal" value={entryKm} onChange={(e) => setEntryKm(e.target.value)} placeholder="z. B. 82450" className="h-11 min-w-0 flex-1 rounded-lg border border-fb-border bg-fb-surface px-3 text-sm font-normal text-fb-text" /><span className="text-sm text-fb-muted">km</span></span></label>
          <button type="submit" disabled={savingReading || !vehicleId || !entryDate || !entryKm} className="h-11 rounded-lg bg-fb-accent px-[18px] text-sm font-semibold text-fb-accent-text disabled:opacity-50">{savingReading ? "Speichert …" : t("statistics.saveReading")}</button>
          {readings.filter((r) => r.vehicleId === vehicleId).length > 0 && <button type="button" onClick={() => setReadingLogOpen(true)} className="h-11 rounded-lg border border-fb-border bg-fb-main px-4 text-sm font-semibold text-fb-text hover:border-fb-accent">{t("statistics.readingLog", { count: readings.filter((r) => r.vehicleId === vehicleId).length })}</button>}
        </form>
      </section>
      {leasing && <section className={`rounded-xl border bg-fb-main p-[22px] ${leasing.deviationKm > 0 ? "border-fb-danger/50" : "border-fb-border"}`}>
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-bold">{leasing.vehicle.acquisitionType === "leasing" ? "Leasing-Kilometer" : "Vertragskilometer"}</h2><p className="mt-1 text-sm text-fb-muted">{new Intl.DateTimeFormat("de-DE").format(new Date(`${leasing.vehicle.leaseStartDate.slice(0,10)}T00:00:00`))} – {new Intl.DateTimeFormat("de-DE").format(new Date(`${leasing.vehicle.leaseEndDate.slice(0,10)}T00:00:00`))} · {km(leasing.vehicle.leaseIncludedKm)} Kilometerlimit</p></div>{leasing.deviationKm > 0
          ? <span className="self-start rounded-full bg-fb-danger/10 px-3 py-1.5 text-xs font-semibold text-fb-danger">{leasing.vehicle.acquisitionType === "leasing" ? "Mehrkilometer erwartet" : "Kilometerlimit voraussichtlich überschritten"}</span>
          : leasing.deviationKm != null && <span className="self-start rounded-full bg-emerald-600/10 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">{t("statistics.onTrack")}</span>}</div>
        <p className="mt-3 text-xs text-fb-muted">Basis: {km(leasing.baselineKm)} am {new Intl.DateTimeFormat("de-DE").format(leasing.baselineDate)} → aktueller Stand {km(leasing.currentOdometerKm)}{!leasing.baselineIsExact ? " · Keine Ablesung am Vertragsbeginn; die Fahrleistung wird anhand des verfügbaren Ablesezeitraums hochgerechnet." : ""}</p>
        <p className="mt-1 text-xs text-fb-muted">Letzte Ablesung: {km(leasing.lastReadingKm)} am {new Intl.DateTimeFormat("de-DE").format(leasing.lastReadingDate)} · danach erfasste Fahrten: {km(leasing.gpsSinceReadingKm)}. Zwischenablesungen ersetzen die zuvor geschätzten Fahrtkilometer.</p>
        <div className={`mt-5 grid gap-4 sm:grid-cols-2 ${(leasing.vehicle.acquisitionType === "leasing" || leasing.vehicle.leaseExcessRateEur != null || leasing.vehicle.leaseShortfallRateEur != null) ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}><div><div className="text-xs text-fb-muted">Bisher gefahren</div><div className="mt-1 text-xl font-bold">{km(leasing.drivenKm)}</div></div><div><div className="text-xs text-fb-muted">Zeitanteilig vorgesehen</div><div className="mt-1 text-xl font-bold">{km(leasing.allowedKm)}</div></div><div><div className="text-xs text-fb-muted">Prognose Vertragsende</div><div className="mt-1 text-xl font-bold">{km(leasing.projectedKm)}</div></div><div><div className="text-xs text-fb-muted">Prognose Abweichung</div><div className={`mt-1 text-xl font-bold ${leasing.deviationKm > 0 ? "text-fb-danger" : "text-fb-accent"}`}>{leasing.deviationKm > 0 ? "+" : ""}{km(leasing.deviationKm)}</div></div>{(leasing.vehicle.acquisitionType === "leasing" || leasing.vehicle.leaseExcessRateEur != null || leasing.vehicle.leaseShortfallRateEur != null) && <div><div className="text-xs text-fb-muted">Nachzahlung / Erstattung (Prognose)</div><div className={`mt-1 text-xl font-bold ${leasing.settlementEur > 0 ? "text-fb-danger" : "text-fb-accent"}`}>{leasing.settlementConfigured ? new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Math.abs(leasing.settlementEur)) : "–"}</div><div className="mt-1 text-xs text-fb-muted">{!leasing.settlementConfigured ? "Kilometersatz nicht hinterlegt" : leasing.settlementEur > 0 ? "Voraussichtliche Nachzahlung" : leasing.settlementEur < 0 ? "Voraussichtliche Erstattung" : "Keine Zahlung erwartet"}</div></div>}</div>
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-fb-muted">
            <span>Kilometerverbrauch im Verhältnis zum Vertragslimit</span>
            <span>{km(leasing.drivenKm)} / {km(leasing.vehicle.leaseIncludedKm)} ({(leasing.drivenKm / leasing.vehicle.leaseIncludedKm * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %)</span>
          </div>
          <div role="progressbar" aria-label="Kilometerverbrauch" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, leasing.drivenKm / leasing.vehicle.leaseIncludedKm * 100))} className="relative h-2.5 overflow-hidden rounded-full bg-fb-surface">
            <div className={`h-full rounded-full ${leasing.drivenKm >= leasing.vehicle.leaseIncludedKm ? "bg-fb-danger" : "bg-fb-accent"}`} style={{ width: `${Math.min(100, Math.max(0, leasing.drivenKm / leasing.vehicle.leaseIncludedKm * 100))}%` }} />
            <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-fb-text" style={{ left: `${Math.min(100, Math.max(0, leasing.elapsedPercent))}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-fb-muted">{t("statistics.targetMarker", { value: percent(leasing.elapsedPercent) })}</p>
        </div>
      </section>}
      <section className="rounded-xl border border-fb-border bg-fb-main p-[22px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-lg font-bold">Kilometerentwicklung</h2><p className="mt-1 text-sm text-fb-muted">{t("statistics.chartHint")}</p></div>
          <div className="flex flex-wrap items-center gap-4">
            {monthlyContractLimit != null && <label className="flex cursor-pointer items-center gap-2 text-xs text-fb-muted"><input type="checkbox" checked={showMonthlyLimit} onChange={(event) => setShowMonthlyLimit(event.target.checked)} className="accent-[var(--color-accent)]" />Monatslimit zeigen</label>}
            <label className="sr-only" htmlFor="chart-year">Jahr</label><select id="chart-year" value={chartYear} onChange={(e) => setChartYear(e.target.value)} className="h-10 rounded-lg border border-fb-border bg-fb-main px-3 text-sm">{chartYears.length === 0 && <option value={chartYear}>{chartYear}</option>}{chartYears.map((year) => <option key={year} value={year}>{year}</option>)}</select>
          </div>
        </div>
        {stackedMonths.length > 0 ? (
          <StackedMonthChart
            months={stackedMonths}
            monthlyLimitKm={showMonthlyLimit ? monthlyContractLimit : null}
            selectedMonth={month}
            onSelectMonth={(key) => {
              setMonth(key);
              document.getElementById("statistics-month-details")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            labelFor={(key) => (key === "unexplainedKm" ? t("statistics.unexplained") : labels[key])}
          />
        ) : chartData.length > 0 ? <StatisticsChart data={chartData} monthlyLimitKm={showMonthlyLimit ? monthlyContractLimit : null} /> : <div className="mt-5 rounded-lg bg-fb-surface p-6 text-center text-sm text-fb-muted">Für diesen Zeitraum liegen noch nicht genügend Ablesungen für ein Diagramm vor.</div>}
      </section>
      {intervalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIntervalModalOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="interval-modal-title" className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-fb-border bg-fb-main shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-fb-border p-5">
              <h2 id="interval-modal-title" className="text-lg font-bold">Genauigkeit nach Ableseintervall</h2>
              <button type="button" onClick={() => setIntervalModalOpen(false)} aria-label="Schließen" className="rounded-lg border border-fb-border px-3 py-2 text-sm hover:border-fb-accent">Schließen</button>
            </div>
            <div className="overflow-y-auto p-5">
          <p className="mt-1 text-sm text-fb-muted">Je kürzer die Intervalle zwischen zwei Ablesungen sind, desto genauer lässt sich erkennen, in welchem Zeitraum Kilometer nicht durch aufgezeichnete Fahrten erklärt werden.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-fb-border text-fb-muted">
                <tr><th className="py-2 pr-4">Zeitraum</th><th className="py-2 pr-4">Kilometerstand</th><th className="py-2 pr-4">Tatsächlich</th><th className="py-2 pr-4">Erfasst</th><th className="py-2 pr-4">Differenz</th><th className="py-2">Fahrten</th></tr>
              </thead>
              <tbody>
                {intervals.map((item) => {
                  const formatDate = (value) => new Intl.DateTimeFormat("de-DE").format(new Date(`${value}T00:00:00`));
                  const significant = Math.abs(item.differenceKm) > Math.max(1, item.actualKm * 0.05);
                  return <tr key={`${item.startReadingId}-${item.endReadingId}`} className="border-b border-fb-border/60 last:border-0">
                    <td className="py-3 pr-4 font-semibold">{formatDate(item.startDate)} – {formatDate(item.endDate)}</td>
                    <td className="py-3 pr-4">{km(item.startOdometerKm)} → {km(item.endOdometerKm)}</td>
                    <td className="py-3 pr-4">{km(item.actualKm)}</td>
                    <td className="py-3 pr-4">{km(item.trackedKm)}</td>
                    <td className={`py-3 pr-4 font-semibold ${significant ? "text-fb-danger" : ""}`}>{item.differenceKm > 0 ? "+" : ""}{km(item.differenceKm)}</td>
                    <td className="py-3">{item.tripCount}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
            </div>
          </section>
        </div>
      )}
      <section id="statistics-month-details" className="scroll-mt-6 rounded-xl border border-fb-border bg-fb-main p-[22px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{selected ? monthLabel(selected.month) : t("statistics.monthTitle")}</h2>
            <p className="mt-1 text-sm text-fb-muted">
              {selected
                ? (selected.actualKm != null ? `Tacho ${km(selected.actualKm)} · erfasst ${km(selected.trackedKm)}` : `Erfasst ${km(selected.trackedKm)} · Monatsgrenzen nicht vollständig abgelesen`)
                : t("statistics.monthHint")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label={t("statistics.year")}
              value={selectedYear}
              disabled={availableYears.length === 0}
              onChange={(e) => {
                const year = e.target.value;
                const firstMonth = availableMonths.find((value) => value.startsWith(`${year}-`));
                setMonth(firstMonth || "");
              }}
              className="h-10 rounded-lg border border-fb-border bg-fb-main px-3 text-sm disabled:opacity-50"
            >
              {availableYears.length === 0 && <option value="">Kein Jahr</option>}
              {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
            <select
              aria-label={t("statistics.month")}
              value={month}
              disabled={monthsForYear.length === 0}
              onChange={(e) => setMonth(e.target.value)}
              className="h-10 rounded-lg border border-fb-border bg-fb-main px-3 text-sm disabled:opacity-50"
            >
              {monthsForYear.length === 0 && <option value="">Kein Monat</option>}
              {monthsForYear.map((value) => <option key={value} value={value}>{monthLabel(value).replace(/\s+\d{4}$/, "")}</option>)}
            </select>
            {intervals.length > 0 && (
              <button type="button" onClick={() => setIntervalModalOpen(true)} className="h-10 rounded-lg border border-fb-border bg-fb-main px-3.5 text-[13px] font-semibold text-fb-text hover:border-fb-accent">Genauigkeit nach Ableseintervall</button>
            )}
          </div>
        </div>
        {selected && (
          <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
            {parts.map(([key, value]) => {
              const unknown = key === "unknownKm";
              const share = total > 0 && value != null ? Math.min(100, Math.max(0, Number(value) / total * 100)) : 0;
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => openCategory(key)}
                  className={`rounded-lg border p-3.5 text-left transition hover:border-fb-accent ${unknown ? "border-fb-danger/40 bg-fb-danger/5" : "border-fb-border bg-fb-surface"}`}
                >
                  <span className="flex items-center gap-1.5 text-xs text-fb-muted"><span aria-hidden="true" className={`size-2 rounded-full ${PART_COLORS[key]}`} />{labels[key]}</span>
                  <span className={`mt-0.5 block text-xl font-bold ${unknown ? "text-fb-danger" : ""}`}>{km(value)}</span>
                  <span className="mt-0.5 block text-xs text-fb-muted">{percent(share)}</span>
                </button>
              );
            })}
          </div>
        )}
        {selected && selected.actualKm != null && (
          <p className="mt-4 border-t border-fb-border pt-3 text-xs text-fb-muted">Kilometerstand: {km(selected.startOdometerKm)} → {km(selected.endOdometerKm)}</p>
        )}
      </section>
      {categoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCategoryModal(null); }}>
          <section role="dialog" aria-modal="true" aria-label={labels[categoryModal]} className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-fb-border bg-fb-main p-5 shadow-xl">
            <header className="flex items-start justify-between gap-3">
              <div><h2 className="text-xl font-bold">{labels[categoryModal]}</h2><p className="text-sm text-fb-muted">{monthLabel(month)}</p></div>
              <button type="button" onClick={() => setCategoryModal(null)} className="rounded-lg border border-fb-border px-3 py-2">Schließen</button>
            </header>
            {categoryModal === "unknownKm" ? (
              <div className="mt-5 space-y-3 text-sm">
                <p>„Unbekannt / nicht erfasst“ ist keine Fahrtenkategorie. Die Kilometer ergeben sich aus der Differenz zwischen Kilometerstandsänderung und aufgezeichneten Fahrten. Einzelne Fahrten können daher nicht aufgelistet werden.</p>
                <p>Kilometerstand: {km(selected?.startOdometerKm)} → {km(selected?.endOdometerKm)}</p>
                <p>Erfasste Fahrten: {km(selected?.trackedKm)}</p>
                <p>Nicht erfasst (berechnet): {km(selected?.unknownKm)}</p>
                <p className="text-fb-muted">Ohne passende Ablesungen für den Monatszeitraum ist die Differenz nicht zuverlässig bestimmbar.</p>
              </div>
            ) : (
              <div className="mt-5">
                {categoryLoading && <p>Lade Fahrten …</p>}
                {categoryError && <p role="alert" className="text-fb-danger">{categoryError}</p>}
                {!categoryLoading && !categoryError && <><p className="mb-3 text-sm text-fb-muted">{categoryTrips.length} Fahrten · {km(categoryTrips.reduce((sum, trip) => sum + trip.distanceKm, 0))}</p>
                  <div className="space-y-2">{categoryTrips.map((trip) => <div key={trip.id} className="rounded-lg border border-fb-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><strong>{new Date(trip.startedAt).toLocaleString("de-DE")}</strong><strong>{km(trip.distanceKm)}</strong></div>
                    <p className="mt-1 text-sm text-fb-muted">{trip.startAddress || "Start unbekannt"} → {trip.endAddress || "Ziel unbekannt"}</p>
                    {categoryModal === "unclassifiedKm" && <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-fb-muted">Zuordnen:</span>
                      {[
                        ["business", "Beruflich"],
                        ["private", "Privat"],
                        ["commute", "Arbeitsweg"],
                      ].map(([type, label]) => <button key={type} type="button"
                        disabled={classifyingTripId !== null}
                        onClick={() => classifyCategoryTrip(trip.id, type)}
                        className="rounded-lg border border-fb-border px-3 py-1.5 text-xs font-semibold hover:border-fb-accent disabled:opacity-50">
                        {classifyingTripId === trip.id ? "Speichern …" : label}
                      </button>)}
                    </div>}
                  </div>)}</div>
                  {!categoryTrips.length && <p className="text-sm text-fb-muted">Keine Fahrten gefunden.</p>}
                </>}
              </div>
            )}
          </section>
        </div>
      )}
      <OdometerReadingLogModal
        open={readingLogOpen}
        onClose={() => setReadingLogOpen(false)}
        readings={readings.filter((reading) => reading.vehicleId === vehicleId)}
        vehicleName={vehicles.find(([id]) => id === vehicleId)?.[1]}
        onEdit={(reading) => {
          setEntryDate(reading.readingDate || `${reading.month}-01`);
          setEntryKm(String(reading.odometerKm));
          setEntryTime(reading.readingAt ? new Date(reading.readingAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "");
        }}
      />
    </div>
  );
}
