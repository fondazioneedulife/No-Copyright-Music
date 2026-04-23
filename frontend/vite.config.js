import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // In sviluppo React gira su 5173, ma queste route vengono servite dal backend Node su 3000.
    // Usa `npm run dev` dalla root per avviare automaticamente entrambi.
    proxy: {
      "/api": "http://localhost:3000",
      "/assets": "http://localhost:3000",
      "/uploads": "http://localhost:3000",
    },
  },
});
