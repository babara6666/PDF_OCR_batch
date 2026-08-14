import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { LanguageProvider } from "./i18n/index.jsx";

// Self-hosted fonts — bundled into the build so the app works with no internet
// access (offline / air-gapped deployments). Loading these from Google Fonts
// made every Material Symbols icon render as its raw ligature text.
import "material-symbols/outlined.css";
import "@fontsource-variable/manrope";
import "@fontsource-variable/noto-serif-jp";

import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>
);
