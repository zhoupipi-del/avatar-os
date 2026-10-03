import { getCurrentWindow, currentMonitor, PhysicalPosition } from "@tauri-apps/api/window";
import type { WindowPort } from "../companion/desktop-walker";
import { isTauri } from "./is-tauri";

/** 走动用的真实窗口操作（物理像素）。非 Tauri 环境返回 null，走动功能自动关闭。 */
export function createTauriWindowPort(): WindowPort | null {
  if (!isTauri()) return null;
  const win = getCurrentWindow();
  return {
    async getPosition() {
      const p = await win.outerPosition();
      return { x: p.x, y: p.y };
    },
    async getSize() {
      const s = await win.outerSize();
      return { width: s.width, height: s.height };
    },
    async getWorkArea() {
      const m = await currentMonitor();
      if (!m) return null;
      const wa = m.workArea ?? { position: m.position, size: m.size };
      return { x: wa.position.x, y: wa.position.y, width: wa.size.width, height: wa.size.height };
    },
    async setPosition(x, y) {
      await win.setPosition(new PhysicalPosition(x, y));
    },
    async scaleFactor() {
      return win.scaleFactor();
    },
  };
}
