import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { apiGet } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";

// Serverseitige Feature-Flags (z. B. Kosten nur im dev-Image) plus Instanz-Status
// (Ersteinrichtung abgeschlossen, SMTP vorhanden, Gravatar erlaubt).
// Solange unbekannt, gelten Funktionen als aus – lieber kurz versteckt als kurz kaputt.
const EMPTY = { loaded: false, features: {}, setupCompleted: null, mailEnabled: false, gravatarEnabled: false, geocodingEnabled: false, routingEnabled: false };
const FeaturesContext = createContext({ ...EMPTY, reload: () => Promise.resolve() });

function fromResponse(result) {
  return {
    loaded: true,
    features: result?.features || {},
    // Ältere Server kennen den Schlüssel nicht – dann gilt die Einrichtung als erledigt
    setupCompleted: result?.setup ? Boolean(result.setup.completed) : true,
    mailEnabled: Boolean(result?.mail?.enabled),
    gravatarEnabled: result?.gravatar ? Boolean(result.gravatar.enabled) : true,
    // Adresssuche und Streckenberechnung (z. B. beim manuellen Anlegen einer Fahrt)
    geocodingEnabled: result?.geocoding ? result.geocoding.enabled !== false : false,
    routingEnabled: Boolean(result?.routing?.enabled),
  };
}

export function FeaturesProvider({ children }) {
  const { accessToken, isAuthenticated } = useAuth();
  const [state, setState] = useState(EMPTY);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      setState(fromResponse(await apiGet(accessToken, "/api/v1/config/services")));
    } catch {
      setState({ ...EMPTY, loaded: true, setupCompleted: true });
    }
  }, [accessToken]);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      setState(EMPTY);
      return undefined;
    }
    let active = true;
    apiGet(accessToken, "/api/v1/config/services")
      .then((result) => { if (active) setState(fromResponse(result)); })
      .catch(() => { if (active) setState({ ...EMPTY, loaded: true, setupCompleted: true }); });
    return () => { active = false; };
    // Nur bei An-/Abmeldung neu laden, nicht bei jedem Token-Refresh
  }, [isAuthenticated]);

  return <FeaturesContext.Provider value={{ ...state, reload }}>{children}</FeaturesContext.Provider>;
}

export function useFeatures() {
  return useContext(FeaturesContext);
}
