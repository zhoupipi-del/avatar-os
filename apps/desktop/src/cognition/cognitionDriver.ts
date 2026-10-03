// ============================================================
// cognitionDriver — desktop 胶水层
// ============================================================
// 把"真 CognitionEngine"适配成 RuntimeKernel 期望的 CognitionDriver 接口。
//
// 为什么放 desktop 而不是 runtime：
//   @avatar-os/cognition 依赖 @avatar-os/runtime，runtime 不能反向 import cognition
//   （循环依赖）。因此 RuntimeKernel 只定义 CognitionDriver 接口，由 desktop 负责
//   实例化真正的引擎并注入。App 调用本工厂，绝不在 App.tsx 里直接 new CognitionEngine()。
//
// v0.4.0 陪伴模式：大模型来源（云端 / Ollama / 关闭）与人设都来自 companionSettings，
// 并把最近的聊天记录作为上下文，让主动说的话能接上之前聊的事。
// ============================================================

import { CognitionEngine } from "@avatar-os/cognition";
import { AgentSandbox, avatarFSM, driveEngine } from "@avatar-os/runtime";
import type { CognitionDriver, StimulusInput } from "@avatar-os/runtime";
import { localFetch } from "../platform/local-fetch";
import { companionSettings } from "../companion/companion-settings";
import { CompanionKernelProvider } from "../companion/kernel-llm-provider";
import { buildProactivePersona } from "../companion/persona";
import { recentConversationLines } from "../companion/conversation-store";

/**
 * 创建认知驱动实例（desktop 应在 bootstrap 中只调一次）。
 * 返回的对象可直接喂给 RuntimeKernel 的 `cognition` 字段。
 */
export function createCognitionDriver(): CognitionDriver {
  const provider = new CompanionKernelProvider(companionSettings, localFetch);
  const engine = new CognitionEngine(AgentSandbox, provider, {
    persona: () => buildProactivePersona(companionSettings.get()),
  });

  return {
    async stimulate(input: StimulusInput): Promise<void> {
      const mood = avatarFSM.getMood().current;
      const state = driveEngine.getState();
      const name = companionSettings.get().companionName.trim() || "我";
      await engine.think({
        userInput: input.text && input.text.length > 0 ? input.text : undefined,
        recentMemories: recentConversationLines(8, name),
        currentMood: mood,
        energy: state.energy,
        loneliness: state.pressures.lonelinessPressure,
      });
    },
  };
}
