import { useEffect } from "react";
import { Avatar } from "./avatar/Avatar";
import { presenceEngine } from "@avatar-os/presence";
import { telemetry } from "@avatar-os/telemetry";
import { memoryStore } from "@avatar-os/memory";
import { eventBus, LifeLoop, behaviorVM, registerDefaultRules } from "@avatar-os/runtime";
import { PresenceSensorLayer } from "@avatar-os/sensor";
import { setClickThrough } from "./window/window-state";

const DRIVE_TICK_MS = 1000;

/**
 * 桌面壳应用入口：只负责「内核自举 + 渲染挂载」。
 * 任何生命状态决策都不在此发生——全部经 LifeLoop → kernelEventBus 由
 * DriveEngine / BehaviorVM / Morphology 路由。App 仅做装配与 click-through 联动。
 */
export default function App() {
  useEffect(() => {
    // 自举顺序：遥测订阅 → 记忆库初始化 → 行为规则注册 → 存在感引擎启动
    telemetry.init();
    void memoryStore.init();
    registerDefaultRules(behaviorVM);
    presenceEngine.start();

    // 在场感知层：绑定到 body（avatar 居中，body 中心≈avatar 中心）
    const presenceLayer = new PresenceSensorLayer();
    presenceLayer.attach(document.body);
    presenceLayer.start(() => {});

    // 生命闭环：每 tick 采样真实在场 → DriveEngine → BehaviorVM → Morphology
    const lifeLoop = new LifeLoop({
      presenceProvider: () => presenceLayer.getPresence(),
      interactionBonusProvider: () => memoryStore.getRecentInteractionBonus(),
      interactionLogger: (intent) => {
        // O6：孤独偷看行为落盘为交互记忆，反哺记忆甜度
        if (intent.type === "PEEK") {
          memoryStore.remember({
            eventType: "EVENT_PEEK_EXECUTED",
            importanceScore: 0.6,
            timestamp: Date.now(),
          });
        }
      },
      tickMs: DRIVE_TICK_MS,
    });
    lifeLoop.start();

    // 沉睡/疲惫时启用点击穿透，清醒时恢复可交互
    const unbindMood = eventBus.on("STATE_MOOD_CHANGED", (p) => {
      const drowsy = p.mood === "SLEEPING" || p.mood === "TIRED";
      void setClickThrough(drowsy);
    });

    return () => {
      unbindMood();
      lifeLoop.stop();
      presenceLayer.stop();
      presenceEngine.stop();
    };
  }, []);

  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Avatar />
    </main>
  );
}
