import { PhysicalIntentType, makeIntent } from "@avatar-os/primitives";
import { kernelEventBus } from "./event-bus";

/**
 * AgentSandbox — 受控外部意图注入入口（LLM / 多模态等不可信来源）。
 *
 * 设计边界（对齐现有内核契约）：
 *   - 外部来源一律用合法 IntentSource "AI"（真实 VALID_SOURCES =
 *     DRIVE/SENSOR/MEMORY/AI/SYSTEM，无 EXTERNAL_LLM，否则会被门禁拒掉）。
 *   - 用 makeIntent 单对象工厂构造（真实签名 makeIntent(partial)），
 *     不自行拼 PhysicalIntent，保证 priority/source/confidence/timestamp 一致。
 *   - 真正派发：emit PHYSICAL_INTENT_DISPATCH，交现有 Arbiter 正常抢占仲裁。
 *     沙箱本身不改变 DriveEngine / LifeState，只"提议"一个 PhysicalIntent。
 */
export class AgentSandbox {
  /**
   * 让外部 Agent / LLM 提议一个物理意图。
   * @returns 是否成功派发（intensity 越界或被门禁拦截则失败）
   */
  public static dispatchExternalIntent(
    intentType: PhysicalIntentType,
    intensity = 0.5,
  ): boolean {
    if (intensity < 0 || intensity > 1) {
      console.error("[AgentSandbox ⛔] intensity out of [0,1]:", intensity);
      return false;
    }

    const intent = makeIntent({
      type: intentType,
      intensity,
      source: "AI",
    });

    kernelEventBus.emit("PHYSICAL_INTENT_DISPATCH", intent);
    console.log(`[AgentSandbox 🟢] Dispatched external intent: ${intentType} (source=AI)`);
    return true;
  }
}
