import {
  Navigate,
  Outlet,
} from "react-router-dom";

import { useAuth } from "./AuthProvider.jsx";

export default function AdminRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (user?.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
