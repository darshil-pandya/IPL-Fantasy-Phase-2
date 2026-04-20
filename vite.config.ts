import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** Must match `base` path segment and your GitHub repo name for Project Pages. */
const REPO = "IPL-Fantasy-Phase-2";

/**
 * GitHub Pages serves 404.html on unknown paths; copy the SPA shell so deep links work.
 */
function spaFallback404(): Plugin {
  return {
    name: "spa-fallback-404",
    closeBundle() {
      const root = resolve(__dirname, "dist", REPO);
      const index = resolve(root, "index.html");
      if (existsSync(index)) cpSync(index, resolve(root, "404.html"));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), spaFallback404()],
  base: `/${REPO}/`,
  build: {
    outDir: `dist/${REPO}`,
    emptyOutDir: true,
  },
});
