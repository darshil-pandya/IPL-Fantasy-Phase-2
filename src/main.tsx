import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import faviconUrl from "./favicon.svg?url";
import App from "./App.tsx";
import "./index.css";

const link = document.createElement("link");
link.rel = "icon";
link.type = "image/svg+xml";
link.href = faviconUrl;
document.head.appendChild(link);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
