import { NavLink, Outlet } from "react-router-dom";

export default function AppLayout() {
  return (
    <div className="app-shell">
      <header className="topbar"><strong>Fahrtenbuch</strong><span className="muted">Self-hosted</span></header>
      <nav className="nav">
        <NavLink to="/">Dashboard</NavLink>
        <NavLink to="/trips">Fahrten</NavLink>
        <NavLink to="/vehicles">Fahrzeuge</NavLink>
        <NavLink to="/settings">Einstellungen</NavLink>
      </nav>
      <main className="content"><Outlet /></main>
    </div>
  );
}
