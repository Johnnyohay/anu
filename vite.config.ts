import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The ANU app lives in app/ and builds to app-dist/, which src/server.ts serves.
// `npm run app:dev` runs Vite with hot reload and forwards /api to the local server.
export default defineConfig({
  root: "app",
  plugins: [react()],
  build: { outDir: "../app-dist", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
