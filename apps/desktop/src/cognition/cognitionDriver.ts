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
// 生命状态从 runtime 的 avatarFSM / driveEngine 实时读取，保证大脑读到的是
// 运行中的真实 PAD / 驱动压力，而非快照副本。
// ============================================================

import { OllamaProvider, CognitionEngine } from "@avatar-os/cognition";
import { AgentSandbox, avatarFSM, driveEngine } from "@avatar-os/runtime";
import type { CognitionDriver, StimulusInput } from "@avatar-os/runtime";

/**
 * 本地 Ollama 模型。
 * 构建期环境变量 VITE_OLLAMA_MODEL 可覆盖（如换 qwen2.5:7b / 14b），未设置时兜底 qwen2.5:0.5b——
 * 它已验证可经 CognitionEngine 正常产出中文 speech + 合法 intent/mood，保证"开箱即活"。
 */
function resolveLocalModel(): string {
  const fromVite = (import.meta as any)?.env?.VITE_OLLAMA_MODEL as string | undefined;
  return fromVite || "qwen2.5:0.5b";
}
const LOCAL_MODEL = resolveLocalModel();

/**
 * 创建认知驱动实例（单例语义：每次调用返回新实例，desktop 应在 bootstrap 中只调一次）。
 * 返回的对象可直接喂给 RuntimeKernel 的 `cognition` 字段。
 */
export function createCognitionDriver(): CognitionDriver {
  const provider = new OllamaProvider(LOCAL_MODEL);
  const engine = new CognitionEngine(AgentSandbox, provider);

  return {
    async stimulate(input: StimulusInput): Promise<void> {
      const mood = avatarFSM.getMood().current;
      const state = driveEngine.getState();
      await engine.think({
        userInput: input.text && input.text.length > 0 ? input.text : undefined,
        currentMood: mood,
        energy: state.energy,
        loneliness: state.pressures.lonelinessPressure,
      });
    },
  };
}
