import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      injectRegister: "auto",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        injectionPoint: "self.__WB_MANIFEST",
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
    }),
  ],
  build: {
    outDir: "../src/macrofactor_scraper/static/dashboard",
    emptyOutDir: true
  },
  server: {
    proxy: {
      "/v1": "http://127.0.0.1:8000",
      "/logout": "http://127.0.0.1:8000",
      "/login": "http://127.0.0.1:8000"
    }
  }
});
