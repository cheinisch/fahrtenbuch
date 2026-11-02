import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App.jsx";
import DemoBanner from "./components/DemoBanner.jsx";
import { AuthProvider } from "./auth/AuthProvider.jsx";
import { I18nProvider } from "./i18n/I18nProvider.jsx";
import { FeaturesProvider } from "./lib/features.jsx";
import "./index.css";
import { BASE_PATH } from "./lib/basePath.js";

ReactDOM.createRoot(
  document.getElementById("root"),
).render(
  <React.StrictMode>
    <BrowserRouter basename={BASE_PATH || undefined}>
      <AuthProvider>
        <I18nProvider><FeaturesProvider><App /><DemoBanner /></FeaturesProvider></I18nProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);