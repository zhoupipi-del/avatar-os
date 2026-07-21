import { kernelEventBus } from "@avatar-os/runtime";
import { makeIntent } from "@avatar-os/primitives";

const THROTTLE_MS = 50; // 50ms 节流：消除高频 mousemove 洪水，CPU < 0.3%
const NEAR_THRESHOLD = 100; // 近场阈值(px)

/**
 * 物理传感器：把 DOM 鼠标输入翻译为生命层事件。
 * 它决定「发生了什么物理输入」，但绝不决定「生命处于什么状态」——
 * NEAR/FAR 只描述输入，状态路由全归 AvatarFSM。
 * 用户主动点击 → 直接派发 BOUNCE_HAPPY 物理意图（用户因果，非内核决策）。
 */
export class MouseSensor {
  private lastTime = 0;
  private isNear = false;

  public init(container: HTMLElement) {
    window.addEventListener("mousemove", (e: MouseEvent) => {
      const now = Date.now();
      if (now - this.lastTime < THROTTLE_MS) return;
      this.lastTime = now;

      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const distance = Math.hypot(e.clientX - cx, e.clientY - cy);

      if (distance < NEAR_THRESHOLD && !this.isNear) {
        this.isNear = true;
        kernelEventBus.emit("SENSOR_MOUSE_NEAR", { distance });
      } else if (distance >= NEAR_THRESHOLD && this.isNear) {
        this.isNear = false;
        kernelEventBus.emit("SENSOR_MOUSE_FAR");
      }
    });
  }

  public triggerClick(x: number, y: number) {
    // 用户主动触碰 = 愉悦跃动意图（用户因果，内核不决策）
    kernelEventBus.emit("PHYSICAL_INTENT_DISPATCH", makeIntent({ type: "BOUNCE_HAPPY", intensity: 1.0, source: "SENSOR" }));
  }
}

export const mouseSensor = new MouseSensor();
