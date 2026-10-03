/**
 * 运行环境探测：是否跑在 Tauri WebView 内。
 * 纯浏览器（vite dev 预览 / 测试）下没有 IPC，任何 invoke / plugin 调用都会抛
 * `Cannot read properties of undefined (reading 'invoke')`，必须先判断再调用。
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" &&
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}
