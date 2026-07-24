import { useEffect } from "react";
import { Avatar } from "./avatar/Avatar";
import { telemetry } from "@avatar-os/telemetry";
import { memoryStore } from "@avatar-os/memory";
import {
  eventBus,
  LifeLoop,
  behaviorVM,
  registerDefaultRules,
  AgentSandbox,
  RuntimeKernel,
  avatarFSM,
  driveEngine,
} from "@avatar-os/runtime";
import { PresenceSensorLayer } from "@avatar-os/sensor";
import { setClickThrough } from "./window/window-state";
import { createCognitionDriver } from "./cognition/cognitionDriver";
import { DebugConsole } from "./debug/DebugConsole";
import { AnimationInspector } from "./avatar/skins/AnimationInspector";
import { avatarService, attachAvatarPersistence, IN_MEMORY_AVATAR_STORAGE } from "./avatar/avatar-profiles";
import { createTauriRelationshipRepository, attachRelationshipCloseHandler } from "./persistence/tauri-relationship-repository";

const DRIVE_TICK_MS = 1000;

/**
 * 桌面壳应用入口：只负责「内核自举 + 渲染挂载」。
 * 任何生命状态决策都不在此发生——全部经 LifeLoop → kernelEventBus 由
 * DriveEngine / BehaviorVM / Morphology 路由。App 仅做装配与 click-through 联动。
 */
export default function App() {
  useEffect(() => {
    let lifeLoop: LifeLoop | null = null;
    let presenceLayer: PresenceSensorLayer | null = null;
    let unbindMood: (() => void) | null = null;
    let runtimeKernel: RuntimeKernel | null = null;
    let unbindAvatarPersistence: (() => void) | null = null;

    const bootstrap = async () => {
      // 自举顺序：遥测订阅 → 记忆库初始化（建 SQLite 表）→ 行为规则注册
      telemetry.init();
      await memoryStore.init();
      registerDefaultRules(behaviorVM);

      // 在场感知层：绑定到 body（avatar 居中，body 中心≈avatar 中心）
      presenceLayer = new PresenceSensorLayer();
      presenceLayer.attach(document.body);
      presenceLayer.start(() => {});
      const pl = presenceLayer;

      // 生命闭环：单一 1000ms 心跳。v0.3.6-A——自主行为节律收编进 LifeLoop 内的
      // AutonomousScheduler（阶段感知 + 冷却/打断/去重），不再依赖外部 PresenceEngine。
      // v0.3.7-A——注入关系持久化仓储（Tauri 单真相源；纯内存降级为 null 时不持久化）。
      const relationshipRepository = createTauriRelationshipRepository();
      try {
        attachRelationshipCloseHandler(relationshipRepository);
      } catch {
        // 非 Tauri 上下文（如纯 Vite dev）忽略关闭钩子，不影响启动
      }
      lifeLoop = new LifeLoop({
        presenceProvider: () => pl.getPresence(),
        interactionBonusProvider: () => memoryStore.getRecentInteractionBonus(),
        interactionLogger: (intent) => {
          // O6：孤独偷看行为落盘为交互记忆，反哺记忆甜度
          if (intent.type === "PEEK") {
            void memoryStore.remember({
              eventType: "EVENT_PEEK_EXECUTED",
              importanceScore: 0.6,
              timestamp: Date.now(),
            });
          }
        },
        tickMs: DRIVE_TICK_MS,
        relationshipRepository,
      });
      lifeLoop.start();

      // 调试沙箱：暴露受控外部意图注入入口（LLM/多模态挂载点）。
      // 仅作 window 调试句柄，不改动任何既有自举链路。
      (window as unknown as { __AVATAR_SANDBOX__?: typeof AgentSandbox }).__AVATAR_SANDBOX__ = AgentSandbox;

      // 沉睡/疲惫时启用点击穿透，清醒时恢复可交互
      unbindMood = eventBus.on("STATE_MOOD_CHANGED", (p) => {
        const drowsy = p.mood === "SLEEPING" || p.mood === "TIRED";
        void setClickThrough(drowsy);
      });

      // ===== 闭环验证期：RuntimeKernel 负责把大脑接进运行中的程序 =====
      // 设计红线：App 只做装配，绝不在此直接 new CognitionEngine()。
      // 真引擎由 desktop 胶水 cognitionDriver 创建并注入 CognitionDriver 接口。
      runtimeKernel = new RuntimeKernel({
        cognition: createCognitionDriver(),
        memory: memoryStore,
        getLifeState: () => {
          const mood = avatarFSM.getMood().current;
          const state = driveEngine.getState();
          return {
            mood,
            energy: state.energy,
            loneliness: state.pressures.lonelinessPressure,
          };
        },
        proactive: { enabled: true, lonelinessThreshold: 0.7, intervalMs: 30_000, idleMs: 60_000 },
      });
      runtimeKernel.start();

      // 身体所有权装配：从存储恢复 active avatar（Phase C 接真实存储），
      // 并订阅变更回写。AvatarService 持有事实，App 仅做 Composition Root 接线，不拥有状态。
      unbindAvatarPersistence = attachAvatarPersistence(avatarService, IN_MEMORY_AVATAR_STORAGE);
    };
    void bootstrap();

    return () => {
      unbindMood?.();
      unbindAvatarPersistence?.();
      runtimeKernel?.stop();
      lifeLoop?.stop();
      presenceLayer?.stop();
    };
  }, []);

  // DEV-only 只读开关：不引入新状态管理，仅读 URL query。
  // Inspect 与生产 Avatar 是「替换」关系，不可共存——见 AnimationInspector.tsx
  // 挂载示例注释：useGLTF 按 URL 全局缓存 scene，双挂会抢同一个 Object3D。
  const inspect =
    import.meta.env.DEV && new URLSearchParams(location.search).has("inspect");

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
      {inspect ? <AnimationInspector /> : <Avatar />}
      {import.meta.env.DEV && <DebugConsole />}
    </main>
  );
}
