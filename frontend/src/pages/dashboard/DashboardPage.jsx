export default function DashboardPage() {
  return (
    <>
      <h1>Dashboard</h1>
      <div className="grid">
        <div className="card"><strong>0</strong><div className="muted">Fahrten</div></div>
        <div className="card"><strong>0 km</strong><div className="muted">Gesamtstrecke</div></div>
        <div className="card"><strong>0</strong><div className="muted">Fahrzeuge</div></div>
      </div>
    </>
  );
}
