import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 需要一个固定端口的 dev server（见 src-tauri/tauri.conf.json -> devUrl）
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "localhost",
  },
  envPrefix: ["VITE_", "TAURI_"],
});
