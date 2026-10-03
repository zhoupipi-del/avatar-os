import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { isTauri } from "./is-tauri";

/**
 * 访问本机服务（Ollama）的 fetch。
 *
 * Tauri 打包后页面来源为 http://tauri.localhost，不在 Ollama 默认 OLLAMA_ORIGINS 白名单内，
 * WebView 原生 fetch 会被 CORS 拦截 → 大脑静默退回规则脑。
 * 在 Tauri 内改走 tauri-plugin-http（Rust 侧发请求，无 CORS；capability 只放行 127.0.0.1/localhost:11434）。
 * 插件拒绝（例如自定义了其他 endpoint、超出 scope）时退回原生 fetch；浏览器 dev 下直接原生 fetch。
 */
export const localFetch: typeof fetch = async (input, init) => {
  if (isTauri()) {
    try {
      return await tauriFetch(input as Parameters<typeof tauriFetch>[0], init);
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      console.warn("[localFetch] tauri-plugin-http failed, falling back to window.fetch:", error);
    }
  }
  return fetch(input, init);
};
