import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AuthProvider } from "./state/AuthContext";
import { SettingsProvider } from "./state/SettingsContext";

import "./styles.css";
import "./stage11.css";
import "./web.css";
import { registerSW } from "virtual:pwa-register";
if ("serviceWorker" in navigator && window.isSecureContext)
  registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
