import { useEffect, useRef, useState } from "react";

import { useI18n } from "../../i18n/I18nProvider.jsx";
import { searchAddresses } from "../../api/app.js";

const defaultFieldClass =
  "mt-2 block w-full rounded-lg border border-fb-border bg-fb-surface px-3 py-2.5 text-sm text-fb-text outline-none transition focus:border-fb-accent focus:ring-2 focus:ring-fb-accent-soft";

/**
 * Adressfeld mit Vorschlägen: gespeicherte Orte sofort, Photon-Treffer nach kurzer Pause.
 * Freitext ist erlaubt – dann fehlen nur die Koordinaten (keine Streckenberechnung).
 */
export default function AddressField({ id, label, value, onChange, savedPlaces, accessToken, geocodingEnabled, fieldClass = defaultFieldClass, hideStatus = false, labelClass = "text-sm font-medium" }) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  const query = value.address.trim();
  const saved = savedPlaces
    .filter((place) => !query || `${place.name} ${place.address || ""}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 5)
    .map((place) => ({
      key: `saved-${place.id}`,
      title: place.name,
      subtitle: place.address,
      address: place.address ? `${place.name}, ${place.address}` : place.name,
      coordinate: { lat: place.latitude, lon: place.longitude },
    }));

  useEffect(() => {
    if (!open || !geocodingEnabled || query.length < 3 || value.coordinate) {
      setResults([]);
      return undefined;
    }
    const current = ++requestRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await searchAddresses(accessToken, query, language);
        if (current === requestRef.current) {
          setResults((response.results || []).map((result, index) => ({
            key: result.id || `photon-${index}`,
            title: result.name || result.address,
            subtitle: result.name ? result.address : null,
            address: result.address,
            coordinate: { lat: result.latitude, lon: result.longitude },
          })));
        }
      } catch {
        if (current === requestRef.current) setResults([]);
      } finally {
        if (current === requestRef.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [open, geocodingEnabled, query, value.coordinate, accessToken, language]);

  const options = [...saved, ...results];

  return (
    <div className="relative">
      <label htmlFor={id} className={labelClass}>{label}</label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        className={fieldClass}
        value={value.address}
        placeholder={t("manualTrip.addressPlaceholder")}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(event) => onChange({ address: event.target.value, coordinate: null })}
      />
      {!hideStatus && (
        <p className="mt-1 text-xs text-fb-muted">
          {value.coordinate ? t("manualTrip.addressLocated") : value.address ? t("manualTrip.addressNotLocated") : "\u00a0"}
        </p>
      )}
      {open && (options.length > 0 || loading) && (
        <ul role="listbox" className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-fb-border bg-fb-main shadow-xl">
          {options.map((option) => (
            <li key={option.key}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { onChange({ address: option.address, coordinate: option.coordinate, saved: option.key.startsWith("saved-") }); setOpen(false); }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-fb-surface"
              >
                <span className="font-medium">{option.title}</span>
                {option.subtitle && <span className="block text-xs text-fb-muted">{option.subtitle}</span>}
              </button>
            </li>
          ))}
          {loading && <li className="px-3 py-2 text-xs text-fb-muted">{t("manualTrip.searching")}</li>}
        </ul>
      )}
    </div>
  );
}
