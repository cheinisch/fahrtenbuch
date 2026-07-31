import {
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import AdminRoute from "./auth/AdminRoute.jsx";
import { useAuth } from "./auth/AuthProvider.jsx";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
import AppShell from "./components/AppShell.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import ExportPage from "./pages/Export.jsx";
import ProfileSettings from "./pages/ProfileSettings.jsx";
import Settings from "./pages/Settings.jsx";
import Vehicles from "./pages/Vehicles.jsx";

function LoginRoute() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <LoginPage />;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={<LoginRoute />}
      />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route
            index
            element={<Dashboard />}
          />

          <Route
            path="/vehicles"
            element={<Vehicles />}
          />

          <Route
            path="/export"
            element={<ExportPage />}
          />

          <Route
            path="/profilesettings"
            element={<ProfileSettings />}
          />

          <Route element={<AdminRoute />}>
            <Route
              path="/settings"
              element={<Settings />}
            />
          </Route>
        </Route>
      </Route>

      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />
    </Routes>
  );
}
