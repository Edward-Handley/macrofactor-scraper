import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
