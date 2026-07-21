/**
 * window-state — Tauri 窗口态控制（点击穿透）。
 *
 * 当 Avatar 沉睡/打盹时启用 set_ignore_cursor_events(true)，让鼠标"穿过"
 * 透明窗口，不打扰用户；清醒时关闭，恢复可点击（"摸摸它"按钮仍可触发）。
 *
 * 运行时检测 __TAURI_INTERNALS__：纯浏览器/vite dev 模式下静默降级，
 * 在 Tauri webview 内才真正 invoke Rust 命令。
 */
import { invoke } from "@tauri-apps/api/core";

export async function setClickThrough(ignore: boolean): Promise<void> {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
  if (!w.__TAURI_INTERNALS__) return; // 非 Tauri 环境（Web/Dev），跳过
  try {
    await invoke("set_ignore_cursor_events", { ignore });
  } catch (e) {
    console.warn("[window-state] invoke set_ignore_cursor_events failed:", e);
  }
}
