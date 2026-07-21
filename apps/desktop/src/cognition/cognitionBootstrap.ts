// ============================================================
// cognitionBootstrap — 桌面端"大脑皮层"神经接线 (建议一·子任务B)
// ============================================================
// 把 packages/cognition 的 CognitionEngine 真正挂载到运行中的桌面程序。
// 不是"脑子写了就完事"——这里负责：
//   1. 实例化 LLM 提供者 + 大脑引擎（依赖注入，单例生命周期随 App）。
//   2. 订阅 SPEECH_INPUT：把用户的发言喂给 think()，并装配当前生命状态
//      （mood 来自 avatarFSM、energy/loneliness 来自 driveEngine、
//       recentMemories 从 memoryStore 回读）。
//   3. 订阅 MEMORY_APPEND → 桥接到 memoryStore.remember：
//      补上"总线→持久层"的最后一段——否则认知引擎发的记忆只飘在总线上，
//      从不落库（子任务C验证"记忆是否正确记录"就会是假的）。
//   4. 主动式自发思考循环：孤独感 > 阈值且无近期互动时，think(userInput=undefined)
//      让 Agent 自己开口，体现 DriveEngine 的价值，而非"不推不动"的聊天机器人。
//
// 返回清理函数：注销总线监听 + 清定时器，防止 App 卸载时内存泄漏。
// 不依赖 React（纯 TS 模块），可被任意启动器调用。
// ============================================================

import {
  kernelEventBus,
  AgentSandbox,
  driveEngine,
  avatarFSM,
} from "@avatar-os/runtime";
import { memoryStore } from "@avatar-os/memory";
import { CognitionEngine, OllamaProvider, type LifeContext } from "@avatar-os/cognition";

/** 主动思考评估周期：每 30s 看一眼孤独感 */
const PROACTIVE_MS = 30_000;
/** 孤独压力阈值：超过且近期无互动 → 主动开口 */
const LONELINESS_TRIGGER = 0.7;
/** 近期互动甜度下限：低于此才允许主动打断（刚聊过就不骚扰） */
const INTERACTION_BONUS_FLOOR = 0.2;
/** 喂给 LLM 的最近记忆条数 */
const RECENT_MEMORY_N = 5;

/**
 * 从持久层回读最近的对话记忆，作为 LLM 上下文。
 * 只认认知引擎落盘的发言事件，过滤掉 PEEK/CLICK 等行为事件噪声。
 */
async function collectRecentMemories(n = RECENT_MEMORY_N): Promise<string[]> {
  const all = await memoryStore.dumpEvents();
  return all
    .filter(
      (e) => e.eventType === "EVENT_USER_SPEECH" || e.eventType === "EVENT_AVATAR_SPEECH",
    )
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, n)
    .map((e) => {
      try {
        const parsed = JSON.parse(e.payload ?? "{}");
        return typeof parsed.content === "string" ? parsed.content : e.payload ?? "";
      } catch {
        return e.payload ?? "";
      }
    })
    .filter((s) => s.length > 0);
}

/** 快照当前生命状态，喂给大脑引擎 */
function snapshotLife(): Pick<LifeContext, "currentMood" | "energy" | "loneliness"> {
  return {
    currentMood: avatarFSM.getMood().current,
    energy: driveEngine.getState().energy,
    loneliness: driveEngine.getState().pressures.lonelinessPressure,
  };
}

/**
 * 启动桌面端认知接线。返回清理函数。
 */
export function startCognition(): () => void {
  // 默认走本机 Ollama；qwen2.5:14b 中文快、已下载。
  // 想换 deepseek-r1:8b 只需改这一行（兼容其 <think> 思维链解析）。
  const provider = new OllamaProvider("qwen2.5:14b");
  const brain = new CognitionEngine(AgentSandbox, provider);

  // —— 外部刺激线：用户输入 → 大脑 ——
  const offSpeech = kernelEventBus.on("SPEECH_INPUT", async (msg) => {
    await brain.think({
      userInput: msg.text,
      recentMemories: await collectRecentMemories(),
      ...snapshotLife(),
    });
  });

  // —— 记忆总线 → 持久层桥接（关键缺口补丁）——
  const offMemory = kernelEventBus.on("MEMORY_APPEND", (msg) => {
    const eventType =
      msg.source === "user"
        ? "EVENT_USER_SPEECH"
        : msg.source === "avatar"
          ? "EVENT_AVATAR_SPEECH"
          : "EVENT_SYSTEM_SPEECH";
    void memoryStore.remember({
      eventType,
      payload: JSON.stringify({ content: msg.content }),
      // 系统旁白权重低，用户/AI 对话权重高，进入长期回忆阈值更稳
      importanceScore: msg.source === "system" ? 0.4 : 0.6,
      timestamp: msg.timestamp,
    });
  });

  // —— 内部驱力线：孤独感驱动自发思考 ——
  const proactive = window.setInterval(() => {
    const { loneliness } = snapshotLife();
    const bonus = memoryStore.getRecentInteractionBonus();
    if (loneliness > LONELINESS_TRIGGER && bonus < INTERACTION_BONUS_FLOOR) {
      void (async () => {
        await brain.think({
          userInput: undefined,
          recentMemories: await collectRecentMemories(),
          ...snapshotLife(),
        });
      })();
    }
  }, PROACTIVE_MS);

  return () => {
    offSpeech();
    offMemory();
    window.clearInterval(proactive);
  };
}
