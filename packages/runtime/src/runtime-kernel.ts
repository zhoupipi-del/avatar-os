// ============================================================
// RuntimeKernel — 应用级运行时内核编排器 (v0.2.5 闭环验证阶段)
// ============================================================
// 职责：把"断掉的入口"补上，让 CognitionEngine 真正运转在运行中的桌面程序里，
// 并让记忆从"飘在总线"变成"真落库"。
//
// 设计红线（避免循环依赖）：
//   - packages/cognition 依赖 @avatar-os/runtime，因此 runtime 绝不反向 import cognition。
//   - 认知引擎以「可注入的 CognitionDriver」形式接入：接口在此定义，实例由 desktop 提供。
//   - runtime 只编排三件事：
//       1) SPEECH_INPUT  → 认知驱动（驱动大脑思考）
//       2) MEMORY_APPEND → 记忆持久层（总线→真落库，此前只飘总线）
//       3) loneliness 超阈值 + 长时间无互动 → 自发驱动（自主生命感）
//
// 不在本阶段做的事（遵循"先活起来"原则，避免过度抽象）：
//   - 不抽象 Semantic Action Resolver（GREET→NlaTrack.001 维持手写映射，真机确认后再抽）
//   - 不做 Capability Scanner / VRM / 表情系统
// ============================================================

import { kernelEventBus } from "./event-bus";

/** 外部刺激输入（由前端 Debug Console / 真实输入通道产生） */
export interface StimulusInput {
  text: string;
  timestamp?: number;
}

/** 认知驱动契约：runtime 定义接口，desktop 注入真 CognitionEngine 适配 */
export interface CognitionDriver {
  /** 收到一条刺激（可能为空文本=自发思考），驱动大脑产出意图/话语/情绪 */
  stimulate(input: StimulusInput): Promise<void>;
}

/** 生命状态快照（供认知引擎组装 LifeContext） */
export interface LifeSnapshot {
  mood: string;
  energy: number;
  loneliness: number;
}

/** 记忆持久层契约（结构化，避免 runtime 强依赖 memory 具体类） */
export interface MemoryLike {
  remember(ev: {
    eventType: string;
    payload?: unknown;
    importanceScore: number;
    timestamp: number;
  }): Promise<void>;
}

export interface RuntimeKernelDeps {
  /** 认知驱动（可空；为空时仅做记忆桥接与自发触发占位） */
  cognition?: CognitionDriver;
  /** 记忆持久层 */
  memory: MemoryLike;
  /** 当前生命状态供给（由 desktop 从 avatarFSM / driveEngine 读取） */
  getLifeState: () => LifeSnapshot;
  /** 自发思考配置（孤独感驱动），enabled 缺省为 false */
  proactive?: {
    enabled?: boolean;
    lonelinessThreshold?: number;
    intervalMs?: number;
    idleMs?: number;
    /** 两次主动开口的最小间隔（可为函数，随设置实时变化）；缺省 0 = 不限制（旧行为） */
    cooldownMs?: number | (() => number);
    /** 额外闸门（如：设置里关掉了、处于安静时段），返回 false 则本轮不开口 */
    isAllowed?: () => boolean;
    /** 外部互动时间源（如 VOID 输入框聊天），与 SPEECH_INPUT 取较晚者 */
    getLastUserActivityAt?: () => number;
  };
}

export class RuntimeKernel {
  private unsubs: Array<() => void> = [];
  private proactiveTimer: ReturnType<typeof setInterval> | null = null;
  private lastUserInputAt = 0;
  private lastProactiveAt = 0;

  constructor(private readonly deps: RuntimeKernelDeps) {}

  public start(): void {
    // 1. INPUT → COGNITION：任何 SPEECH_INPUT 都驱动认知引擎
    this.unsubs.push(
      kernelEventBus.on("SPEECH_INPUT", (p: { text: string; timestamp?: number }) => {
        this.lastUserInputAt = Date.now();
        if (this.deps.cognition) {
          void this.deps.cognition.stimulate({ text: p.text, timestamp: p.timestamp });
        }
      }),
    );

    // 2. 记忆闭环：MEMORY_APPEND（来自 cognition 引擎）→ 真落库
    this.unsubs.push(
      kernelEventBus.on(
        "MEMORY_APPEND",
        (p: { source: "user" | "avatar" | "system"; content: string; timestamp?: number }) => {
          const eventType =
            p.source === "user"
              ? "EVENT_USER_SPEECH"
              : p.source === "avatar"
                ? "EVENT_AVATAR_SPEECH"
                : "EVENT_SYSTEM_MESSAGE";
          void this.deps.memory.remember({
            eventType,
            payload: { content: p.content },
            importanceScore: 0.7,
            timestamp: p.timestamp ?? Date.now(),
          });
        },
      ),
    );

    // 3. 自发思考：孤独感超阈值 + 用户长时间未互动 → 主动开口（自主生命感）
    const proactive = this.deps.proactive ?? {};
    if (proactive.enabled) {
      const threshold = proactive.lonelinessThreshold ?? 0.7;
      const intervalMs = proactive.intervalMs ?? 30_000;
      const idleMs = proactive.idleMs ?? 60_000;
      // 启动时刻作为互动基线：刚开机不立刻开口，至少等 idleMs
      this.lastUserInputAt = Math.max(this.lastUserInputAt, Date.now());
      this.proactiveTimer = setInterval(() => {
        const now = Date.now();
        const life = this.deps.getLifeState();
        const lastActivity = Math.max(this.lastUserInputAt, proactive.getLastUserActivityAt?.() ?? 0);
        const idleFor = now - lastActivity;
        const cooldown =
          typeof proactive.cooldownMs === "function" ? proactive.cooldownMs() : (proactive.cooldownMs ?? 0);
        if (life.loneliness < threshold || idleFor < idleMs) return;
        if (this.lastProactiveAt > 0 && now - this.lastProactiveAt < cooldown) return;
        if (proactive.isAllowed && !proactive.isAllowed()) return;
        if (this.deps.cognition) {
          this.lastProactiveAt = now;
          void this.deps.cognition.stimulate({ text: "" });
        }
      }, intervalMs);
    }

    console.log("[RuntimeKernel 🧠] started — cognition bridge + memory bridge + proactive loop online.");
  }

  public stop(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    if (this.proactiveTimer !== null) {
      clearInterval(this.proactiveTimer);
      this.proactiveTimer = null;
    }
    console.log("[RuntimeKernel 🧠] stopped.");
  }
}
