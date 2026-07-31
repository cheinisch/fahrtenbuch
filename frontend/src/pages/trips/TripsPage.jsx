import { useEffect, useState } from "react";
import { listTrips } from "../../api/tripsApi.js";

export default function TripsPage() {
  const [items, setItems] = useState([]);
  useEffect(() => { listTrips().then(setItems).catch(() => setItems([])); }, []);
  return (
    <>
      <h1>Fahrten</h1>
      <div className="card">
        {items.length ? items.map((t) => <div key={t.id}>{t.startedAt} · {t.distanceKm} km</div>) : "Noch keine Fahrten vorhanden."}
      </div>
    </>
  );
}
