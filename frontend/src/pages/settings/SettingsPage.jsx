import { useEffect, useState } from "react";
import { getVersion } from "../../api/systemApi.js";

export default function SettingsPage() {
  const [version, setVersion] = useState("…");
  useEffect(() => { getVersion().then((x) => setVersion(x.version)).catch(() => setVersion("Unbekannt")); }, []);
  return (
    <>
      <h1>Einstellungen</h1>
      <section className="card">
        <h2>Über Fahrtenbuch</h2>
        <p>Version: <strong>{version}</strong></p>
      </section>
    </>
  );
}
