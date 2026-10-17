import { createContext, useContext, useEffect, useState } from "react";

import { apiGet } from "../api/app.js";
import { useAuth } from "../auth/AuthProvider.jsx";

// Serverseitige Feature-Flags (z. B. Kosten nur im dev-Image).
// Solange unbekannt, gelten Funktionen als aus – lieber kurz versteckt als kurz kaputt.
const FeaturesContext = createContext({ loaded: false, features: {} });

export function FeaturesProvider({ children }) {
  const { accessToken, isAuthenticated } = useAuth();
  const [state, setState] = useState({ loaded: false, features: {} });

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      setState({ loaded: false, features: {} });
      return undefined;
    }
    let active = true;
    apiGet(accessToken, "/api/v1/config/services")
      .then((result) => { if (active) setState({ loaded: true, features: result?.features || {} }); })
      .catch(() => { if (active) setState({ loaded: true, features: {} }); });
    return () => { active = false; };
  }, [accessToken, isAuthenticated]);

  return <FeaturesContext.Provider value={state}>{children}</FeaturesContext.Provider>;
}

export function useFeatures() {
  return useContext(FeaturesContext);
}
