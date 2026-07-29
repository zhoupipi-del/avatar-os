import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 需要一个固定端口的 dev server（见 src-tauri/tauri.conf.json -> devUrl）
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // 监听 IPv4 全网卡(含 127.0.0.1)，确保 Tauri WebView2 无论解析到 IPv4/IPv6 都能连上，
    // 避免之前 "localhost 只解析 IPv6 而窗口用 IPv4 连接 -> ERR_CONNECTION_REFUSED" 的问题。
    host: "0.0.0.0",
  },
  envPrefix: ["VITE_", "TAURI_"],
});
