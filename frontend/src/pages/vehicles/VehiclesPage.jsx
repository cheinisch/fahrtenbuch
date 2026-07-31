import { useEffect, useState } from "react";
import { listVehicles } from "../../api/vehiclesApi.js";

export default function VehiclesPage() {
  const [items, setItems] = useState([]);
  useEffect(() => { listVehicles().then(setItems).catch(() => setItems([])); }, []);
  return (
    <>
      <h1>Fahrzeuge</h1>
      <div className="grid">
        {items.length ? items.map((v) => <div className="card" key={v.id}><strong>{v.name}</strong><div className="muted">{v.licensePlate || "Kein Kennzeichen"}</div></div>) : <div className="card">Noch keine Fahrzeuge vorhanden.</div>}
      </div>
    </>
  );
}
