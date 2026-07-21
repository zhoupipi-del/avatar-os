// ============================================================
// IntentRegistry — 意图注册表模式 (v0.1.0-alpha Kernel Skeleton)
// ============================================================
// 设计原则：
//   - 彻底消灭"if-else / switch-case 映射 Intent → 视图"——每个 PhysicalIntent
//     被注册为一个 RenderSpec，由 Viewer 侧 resolve 得到渲染参数。
//   - 注册表是纯数据层（不 import React），渲染逻辑与渲染器解耦。
//   - Day7 Avatar.tsx 瘦身至 <80 行后，<Avatar> 只需 resolve → 直接渲染，
//     不再内嵌任何 mood/motion 条件分支。
// ============================================================

import type { PhysicalIntent } from "@avatar-os/primitives";
import { Mood } from "@avatar-os/primitives";

export interface RenderSpec {
  /** 对应 PhysicalIntentType */
  intentType: string;
  /** 映射到的 Mood（供 Body/Eyes/Mouth 组件消费） */
  mood: Mood;
  /** 动效名称（如 "BREATH" / "HAPPY_BOUNCE" / "DOZE"） */
  motion: string;
  /** 动效优先级（同意图竞争下选更高 priority 的 RenderSpec） */
  priority: number;
  /** 渲染器自定义配置（可被具体渲染器读取） */
  renderConfig?: Record<string, unknown>;
}

export class IntentRegistry {
  private specs: Map<string, RenderSpec> = new Map();

  /** 注册一个意图→渲染映射 */
  public register(spec: RenderSpec): void {
    this.specs.set(spec.intentType, spec);
    console.log(`[IntentRegistry] registered: ${spec.intentType} → mood=${spec.mood} motion=${spec.motion}`);
  }

  /** 根据 PhysicalIntent 解析得到 RenderSpec */
  public resolve(intent: PhysicalIntent): RenderSpec | null {
    return this.specs.get(intent.type) ?? this.specs.get("IDLE_BREATHE") ?? null;
  }
}

// ------- 默认渲染器注册 -------

/**
 * DefaultIdleRenderer — 默认渲染器初始化。
 * 注册最常见的 Day1-7 PhysicalIntent → 视图映射。
 * 未来每个包/组件可以自行 register() 追加或覆盖。
 */
export function registerDefaultRenderers(registry: IntentRegistry): void {
  const defaults: RenderSpec[] = [
    {
      intentType: "IDLE_BREATHE",
      mood: Mood.CALM,
      motion: "BREATH",
      priority: 0,
    },
    {
      intentType: "LOOK_AT_USER",
      mood: Mood.CURIOUS,
      motion: "GAZE_FOLLOW",
      priority: 20,
    },
    {
      intentType: "DOZE",
      mood: Mood.SLEEPING,
      motion: "SLEEP_BREATH",
      priority: 40,
    },
    {
      intentType: "STRETCH",
      mood: Mood.TIRED,
      motion: "STRETCH",
      priority: 30,
    },
    {
      intentType: "GREET",
      mood: Mood.HAPPY,
      motion: "WAVE",
      priority: 50,
    },
    {
      intentType: "PEEK",
      mood: Mood.CURIOUS,
      motion: "PEEK",
      priority: 35,
    },
    {
      intentType: "BOUNCE_HAPPY",
      mood: Mood.PLAYFUL,
      motion: "HAPPY_BOUNCE",
      priority: 60,
    },
  ];

  defaults.forEach((spec) => registry.register(spec));
}

/** 全局注册表单例（冻结期，Day7 Avatar.tsx 瘦身后可移除此全局） */
export const intentRegistry = new IntentRegistry();
registerDefaultRenderers(intentRegistry);
