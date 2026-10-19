import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useFeatures } from "../lib/features.jsx";
import { useAuth } from "./AuthProvider.jsx";

/** Ob der Benutzer vor der App erst durch einen Assistenten muss – und durch welchen. */
export function pendingAssistant(user, setupCompleted) {
  if (!user) return null;
  if (user.role === "admin" && setupCompleted === false) return "/setup";
  // Fehlt das Feld (älterer Server), gilt der Assistent als erledigt
  if (user.onboardingCompleted === false || user.forcePasswordChange) return "/welcome";
  return null;
}

// Leitet beim ersten Login in den passenden Einrichtungsassistenten um.
export default function OnboardingGate() {
  const { user } = useAuth();
  const { loaded, setupCompleted } = useFeatures();
  const location = useLocation();

  // Admins erst nach dem Laden des Instanz-Status beurteilen, sonst blitzt das Dashboard auf
  if (user?.role === "admin" && !loaded) return null;

  const target = pendingAssistant(user, setupCompleted);
  if (!target) return <Outlet />;

  // Rückkehr von der Kontoverknüpfung (Anbieter leitet auf /profilesettings) im Assistenten fortsetzen
  const params = new URLSearchParams(location.search);
  const keep = new URLSearchParams();
  ["oauthLinked", "oauthError"].forEach((key) => {
    if (params.get(key)) keep.set(key, params.get(key));
  });
  const search = keep.toString();

  return <Navigate to={search ? `${target}?${search}` : target} replace />;
}
