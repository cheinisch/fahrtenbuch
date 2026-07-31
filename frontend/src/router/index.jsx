import { createBrowserRouter } from "react-router-dom";
import AppLayout from "../layouts/AppLayout.jsx";
import DashboardPage from "../pages/dashboard/DashboardPage.jsx";
import TripsPage from "../pages/trips/TripsPage.jsx";
import VehiclesPage from "../pages/vehicles/VehiclesPage.jsx";
import SettingsPage from "../pages/settings/SettingsPage.jsx";
import LoginPage from "../pages/auth/LoginPage.jsx";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "trips", element: <TripsPage /> },
      { path: "vehicles", element: <VehiclesPage /> },
      { path: "settings", element: <SettingsPage /> }
    ]
  }
]);
