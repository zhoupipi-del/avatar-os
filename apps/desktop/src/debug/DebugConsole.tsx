// ============================================================
// DebugConsole — AvatarOS 运行时调试控制台 (DEV ONLY)
// ============================================================
// 不是最终聊天 UI。这是"让系统先活一次"阶段的核心可观测工具：
// 把整条生命链路 INPUT → COGNITION → INTENT → ACTION → POSE/ANIMATION
// 实时摊开在眼前，每一跳都有迹可循。
//
// 设计原则：
//   - 只订阅、只发射，不偷偷 mock 任何总线（拒绝虚假安全感）
//   - 输入框 emit SPEECH_INPUT，走真实 Cognition 链路
//   - "Body test" 按钮经 AgentSandbox 直接驱动身体（明确标注"无大脑"），
//     用于在不依赖 Ollama 时单独验证动画/姿态映射
//   - LIVE STATE 只是旁路只读监护仪：订阅已有事件，绝不回写、绝不轮询、绝不控制行为
// ============================================================

import { useEffect, useRef, useState } from "react";
import {
  kernelEventBus,
  AgentSandbox,
  createInitialSnapshot,
  recordIntent,
  recordSpeech,
  recordAction,
  recordClip,
  recordMood,
  recordLifePhase,
  recordAvatarProfile,
  recordAutonomous,
  recordPersonality,
  recordEmotion,
  recordRelationship,
  requestPersonalityProfile,
  BUILTIN_PERSONALITY_PROFILES,
  DEFAULT_PERSONALITY_PROFILE_ID,
  type AgentRuntimeSnapshot,
  type AutonomousBehaviorTuning,
  type EmotionState,
  type RelationshipState,
} from "@avatar-os/runtime";
import type { PhysicalIntentType } from "@avatar-os/primitives";
import { avatarService, AVATAR_PROFILES } from "../avatar/avatar-profiles";

interface LogEntry {
  id: number;
  stage: string;
  text: string;
}

const BODY_TESTS: { label: string; intent: PhysicalIntentType }[] = [
  { label: "👋 GREET", intent: "GREET" },
  { label: "🤸 STRETCH", intent: "STRETCH" },
  { label: "👀 LOOK", intent: "LOOK_AT_USER" },
  { label: "😴 DOZE", intent: "DOZE" },
];

const panelStyle: React.CSSProperties = {
  position: "fixed",
  right: 12,
  bottom: 12,
  width: 340,
  maxHeight: "80vh",
  display: "flex",
  flexDirection: "column",
  background: "rgba(18, 20, 28, 0.82)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid rgba(120, 160, 255, 0.35)",
  borderRadius: 12,
  color: "#d7e3ff",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  zIndex: 9999,
  boxShadow: "0 8px 30px rgba(0,0,0,0.45)",
  overflow: "hidden",
};

/** LIVE STATE 单行：label 与 value 分行，纯文本、无颜色、无状态指示灯。 */
function LiveRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ padding: "1px 0" }}>
      <div style={{ color: "#8aa0c8" }}>{label}:</div>
      <div style={{ paddingLeft: 10, color: value ? "#d7e3ff" : "#4a5878", wordBreak: "break-all" }}>
        {value ?? "—"}
      </div>
    </div>
  );
}

/** 把 epoch ms 格式化为本地时钟串；null 返回 null（LiveRow 会显示破折号）。 */
function fmtClock(ms: number | null | undefined): string | null {
  return ms == null ? null : new Date(ms).toLocaleTimeString();
}

/** 关系诊断描述符（DEV ONLY，非产品"等级"）：按依恋/熟悉度粗略归类，便于肉眼看关系积累。 */
function relProfile(state: RelationshipState | null): string | null {
  if (!state) return null;
  const closeness = state.attachment * 0.5 + state.familiarity * 0.3 + state.relationalTrust * 0.2;
  if (closeness < 0.05) return "stranger";
  if (closeness < 0.2) return "acquaintance";
  if (closeness < 0.45) return "familiar";
  return "close";
}

const fmt2 = (n: number | undefined | null): string | null => (n == null ? null : n.toFixed(2));

/** 把行为调音乘子压成一行可读串（PK/ST/LL = 概率/冷却乘子；UF = 面向用户权重）。 */
function fmtTuning(t: AutonomousBehaviorTuning | null): string | null {
  if (!t) return null;
  const r = (x: number) => x.toFixed(2);
  return `PK ${r(t.peekChanceMultiplier)}/${r(t.peekCooldownMultiplier)} · ST ${r(
    t.stretchChanceMultiplier,
  )}/${r(t.stretchCooldownMultiplier)} · LL ${r(t.lonelyLookChanceMultiplier)}/${r(
    t.lonelyLookCooldownMultiplier,
  )} · UF ${r(t.userFocusWeight)}`;
}

export function DebugConsole() {
  const [collapsed, setCollapsed] = useState(true);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  // LIVE STATE 只读监护仪：唯一事实源是 AgentRuntimeSnapshot，
  // 全部由下方事件订阅经纯函数写入（recordX），本组件不创造任何状态。
  const [snapshot, setSnapshot] = useState<AgentRuntimeSnapshot>(createInitialSnapshot());
  const [log, setLog] = useState<LogEntry[]>([]);
  const logId = useRef(0);

  useEffect(() => {
    const pushLog = (stage: string, text: string) => {
      const id = ++logId.current;
      setLog((prev) => [{ id, stage, text }, ...prev].slice(0, 200));
    };

    // —— 认知侧 ——
    const uThink = kernelEventBus.on("AVATAR_THOUGHT", (p) => {
      if (p.kind === "thinking") {
        setThinking(true);
        pushLog("COGNITION", "thinking…");
      } else if (p.kind === "clear") {
        setThinking(false);
        pushLog("COGNITION", "clear");
      } else {
        setThinking(false);
        if (p.kind === "speech") setSnapshot((s) => recordSpeech(s, p.text ?? ""));
        pushLog("COGNITION", `${p.kind}: ${p.text ?? ""}`);
      }
    });

    // INTENT_NORMALIZED 是真实存在的"大脑决策"事件（无 COGNITION_DECISION 事件，故不虚构）。
    const uNorm = kernelEventBus.on("INTENT_NORMALIZED", (p) => {
      setSnapshot((s) => recordIntent(s, p.normalized));
      const tag = !p.matched ? "UNKNOWN⚠" : p.normalized === "NONE" ? "NONE" : "normalized";
      pushLog("COGNITION", `${tag}: raw="${p.raw}" → ${p.normalized}`);
    });

    // —— 行为侧 ——
    const uIntent = kernelEventBus.on("PHYSICAL_INTENT_DISPATCH", (p) => {
      setSnapshot((s) => recordAction(s, p.type));
      pushLog("INTENT", p.type);
    });

    // —— 身体侧（动画片段派发 = 身体正在播放）——
    const uPrimitive = kernelEventBus.on("AVATAR_PRIMITIVE", (p) => {
      if (p.detail.startsWith("clip=")) {
        setSnapshot((s) => recordClip(s, p.detail.slice(5)));
      }
      pushLog("POSE/ANIM", `${p.type} ${p.detail}`);
    });

    const uMood = kernelEventBus.on("STATE_MOOD_CHANGED", (p) => {
      setSnapshot((s) => recordMood(s, p.mood));
      pushLog("MOOD", p.mood);
    });

    // —— 生命阶段（v0.3.5-A）：LIFE_PHASE_CHANGED → 只读镜像进快照 ——
    const uPhase = kernelEventBus.on("LIFE_PHASE_CHANGED", (p) => {
      setSnapshot((s) => recordLifePhase(s, p.phase));
      pushLog("LIFE", p.phase);
    });

    // —— 身体侧（当前激活 profile，事实在 AvatarService，此处只读镜像）——
    const uAvatar = avatarService.subscribe((s) => {
      setSnapshot((snap) => recordAvatarProfile(snap, s.activeId));
    });

    // —— 自主行为调度器（v0.3.6-A）：AUTONOMOUS_BEHAVIOR_CHANGED → 只读镜像进快照 ——
    const uAuto = kernelEventBus.on("AUTONOMOUS_BEHAVIOR_CHANGED", (p) => {
      setSnapshot((snap) => recordAutonomous(snap, p.state));
    });

    // —— 人格（v0.3.6-B）：PERSONALITY_PROFILE_CHANGED → 只读镜像进快照 ——
    const uPersonality = kernelEventBus.on("PERSONALITY_PROFILE_CHANGED", (p) => {
      setSnapshot((s) => recordPersonality(s, { profileId: p.profileId, traits: p.traits, tuning: p.tuning }));
    });

    // —— 情绪（v0.3.6-C）：EMOTION_STATE_CHANGED → 只读镜像进快照 ——
    const uEmotion = kernelEventBus.on("EMOTION_STATE_CHANGED", (p: { state: EmotionState }) => {
      setSnapshot((s) => recordEmotion(s, p.state));
    });

    // —— 关系（v0.3.7-A）：RELATIONSHIP_STATE_CHANGED → 只读镜像进快照 ——
    const uRelationship = kernelEventBus.on(
      "RELATIONSHIP_STATE_CHANGED",
      (p: { state: RelationshipState; persistenceStatus: string }) => {
        setSnapshot((s) => recordRelationship(s, p));
      },
    );

    // —— 输入 / 记忆：仅入日志，不进 LIVE STATE（它们是"发生了什么"，不是"当前状态"）——
    const uInput = kernelEventBus.on("SPEECH_INPUT", (p) => {
      pushLog("INPUT", `「${p.text}」`);
    });

    const uMemory = kernelEventBus.on("MEMORY_APPEND", (p) => {
      pushLog("MEMORY", `${p.source}: ${p.content.slice(0, 24)}`);
    });

      return () => {
      uThink();
      uNorm();
      uIntent();
      uPrimitive();
      uMood();
      uPhase();
      uAvatar();
      uAuto();
      uPersonality();
      uEmotion();
      uRelationship();
      uInput();
      uMemory();
    };
  }, []);

  const submit = () => {
    const text = input.trim();
    if (!text || thinking) return;
    kernelEventBus.emit("SPEECH_INPUT", { text, timestamp: Date.now() });
    setInput("");
  };

  const bodyTest = (intent: PhysicalIntentType) => {
    AgentSandbox.dispatchExternalIntent(intent, 0.8);
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        style={{
          ...panelStyle,
          width: "auto",
          padding: "8px 12px",
          cursor: "pointer",
          flexDirection: "row",
        }}
        title="展开 AvatarOS Debug Console"
      >
        🐶 OS·DBG
      </button>
    );
  }

  return (
    <div style={panelStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 10px",
          borderBottom: "1px solid rgba(120,160,255,0.2)",
          background: "rgba(120,160,255,0.08)",
        }}
      >
        <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>🐶 AvatarOS · Runtime Debug</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => (location.search = "inspect=1")}
            title="动作标定：进入 Inspect 模式，替换 Avatar 渲染"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              color: "#c7d2e0",
              padding: "2px 6px",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            🎞 INSPECT
          </button>
          <span
            onClick={() => setCollapsed(true)}
            style={{ cursor: "pointer", color: "#8aa0c8", padding: "0 4px" }}
            title="折叠"
          >
            ▢
          </span>
        </span>
      </div>

      {/* LIVE STATE · 只读监护仪：当前生命状态（纯文本，无颜色） */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(120,160,255,0.12)" }}>
        <div style={{ color: "#8aa0c8", fontSize: 11, letterSpacing: 0.5, marginBottom: 4 }}>
          LIVE STATE · 只读监护仪
        </div>
        <LiveRow label="Intent" value={snapshot.cognition.lastIntent} />
        <LiveRow label="Speech" value={snapshot.cognition.speech} />
        <LiveRow label="Action" value={snapshot.behavior.currentAction} />
        <LiveRow label="Last Clip" value={snapshot.behavior.currentClip} />
        <LiveRow label="Avatar" value={snapshot.avatar.animation ? "playing" : "idle"} />
        <LiveRow label="Body" value={snapshot.avatar.activeAvatarId} />
        <LiveRow label="Mood" value={snapshot.avatar.mood} />
        <LiveRow label="Phase" value={snapshot.life.phase} />
        <LiveRow label="Auto Behavior" value={snapshot.autonomous?.behavior ?? null} />
        <LiveRow label="Auto Source" value={snapshot.autonomous?.source ?? null} />
        <LiveRow label="Auto Started" value={fmtClock(snapshot.autonomous?.startedAt)} />
        <LiveRow label="Auto Cooldown" value={fmtClock(snapshot.autonomous?.cooldownUntil)} />
        <LiveRow label="Auto Interrupted" value={snapshot.autonomous?.interruptedBy ?? null} />
        <LiveRow label="Profile" value={snapshot.personality?.profileId ?? null} />
        <LiveRow label="Curiosity" value={snapshot.personality ? String(snapshot.personality.traits.curiosity) : null} />
        <LiveRow label="Sociability" value={snapshot.personality ? String(snapshot.personality.traits.sociability) : null} />
        <LiveRow label="Patience" value={snapshot.personality ? String(snapshot.personality.traits.patience) : null} />
        <LiveRow label="Independence" value={snapshot.personality ? String(snapshot.personality.traits.independence) : null} />
        <LiveRow label="Expressiveness" value={snapshot.personality ? String(snapshot.personality.traits.expressiveness) : null} />
        <LiveRow label="Behavior Tuning" value={fmtTuning(snapshot.personality?.tuning ?? null)} />
        <LiveRow label="Emotion Comfort" value={snapshot.emotion ? snapshot.emotion.comfort.toFixed(2) : null} />
        <LiveRow label="Emotion Trust" value={snapshot.emotion ? snapshot.emotion.trust.toFixed(2) : null} />
        <LiveRow label="Emotion Loneliness" value={snapshot.emotion ? snapshot.emotion.loneliness.toFixed(2) : null} />
        <LiveRow label="Emotion Curiosity" value={snapshot.emotion ? snapshot.emotion.curiosity.toFixed(2) : null} />
        {/* 关系层（v0.3.7-A）：纯数字 / 时间，无进度条。 */}
        <LiveRow label="Rel Profile" value={relProfile(snapshot.relationship)} />
        <LiveRow label="Rel Trust" value={fmt2(snapshot.relationship?.relationalTrust)} />
        <LiveRow label="Familiarity" value={fmt2(snapshot.relationship?.familiarity)} />
        <LiveRow label="Attachment" value={fmt2(snapshot.relationship?.attachment)} />
        <LiveRow label="Interaction Count" value={snapshot.relationship ? String(snapshot.relationship.interactionCount) : null} />
        <LiveRow label="Active Days" value={snapshot.relationship ? String(snapshot.relationship.activeDays) : null} />
        <LiveRow label="First Met At" value={fmtClock(snapshot.relationship?.firstMetAt)} />
        <LiveRow label="Last Interaction At" value={fmtClock(snapshot.relationship?.lastInteractionAt)} />
        <LiveRow label="Persistence Status" value={snapshot.relationshipPersistenceStatus} />
      </div>

      {/* BODY · 运行时切换（DEV ONLY）：这是 Runtime Test Switch，不是产品功能。
          只调 avatarService.activate(id) —— 不直接 load GLB / 不替换场景 / 不碰渲染。
          激活事实在 AvatarService；此处只触发 + 反映当前激活态。
          严禁被改名成 AvatarPicker / CharacterSelect / SkinShop 等概念。 */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(120,160,255,0.12)" }}>
        <div style={{ color: "#8aa0c8", fontSize: 11, letterSpacing: 0.5, marginBottom: 4 }}>
          BODY · 运行时切换 (DEV)
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {Object.keys(AVATAR_PROFILES).map((id) => {
            const isActive = id === snapshot.avatar.activeAvatarId;
            return (
              <button
                key={id}
                onClick={() => avatarService.activate(id)}
                title={`activate ${id}`}
                style={{
                  background: isActive ? "rgba(120,160,255,0.35)" : "rgba(255,255,255,0.05)",
                  border: isActive
                    ? "1px solid rgba(120,160,255,0.85)"
                    : "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 6,
                  color: isActive ? "#eaf0ff" : "#c7d2e0",
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                {isActive ? "● " : ""}
                {id}
              </button>
            );
          })}
        </div>
      </div>

      {/* PERSONALITY · 运行时切换 (DEV ONLY)：这是 Runtime Test Switch，不是产品功能。
          只调 requestPersonalityProfile(id) —— 不直接触调度器内部，与身体切换同理（只触发、不拥有）。
          人格只"调音"，不绕过调度器发意图；安全边界由 applyTuning 底线夹紧保证。 */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(120,160,255,0.12)" }}>
        <div style={{ color: "#8aa0c8", fontSize: 11, letterSpacing: 0.5, marginBottom: 4 }}>
          PERSONALITY · 运行时切换 (DEV)
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(Object.keys(BUILTIN_PERSONALITY_PROFILES) as Array<keyof typeof BUILTIN_PERSONALITY_PROFILES>).map(
            (id) => {
              const isActive = id === (snapshot.personality?.profileId ?? DEFAULT_PERSONALITY_PROFILE_ID);
              return (
                <button
                  key={id}
                  onClick={() => requestPersonalityProfile(BUILTIN_PERSONALITY_PROFILES[id])}
                  title={`set personality ${id}`}
                  style={{
                    background: isActive ? "rgba(120,160,255,0.35)" : "rgba(255,255,255,0.05)",
                    border: isActive
                      ? "1px solid rgba(120,160,255,0.85)"
                      : "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 6,
                    color: isActive ? "#eaf0ff" : "#c7d2e0",
                    padding: "4px 8px",
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  {isActive ? "● " : ""}
                  {id}
                </button>
              );
            },
          )}
        </div>
      </div>

      {/* RELATIONSHIP · 开发态重置 (DEV ONLY)：清空真实关系数据。
          需二次确认，且 DebugConsole 本身仅 DEV 渲染。生产环境不暴露。
          注意：这会删除关系持久化文件并重置为中性——仅用于测试"从陌生重新开始"。 */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,120,120,0.18)" }}>
        <div style={{ color: "#8aa0c8", fontSize: 11, letterSpacing: 0.5, marginBottom: 4 }}>
          RELATIONSHIP · 开发态重置 (DEV)
        </div>
        <button
          onClick={() => {
            if (!window.confirm("清空关系数据？此操作不可撤销（重置后从陌生重新开始）。")) return;
            if (!window.confirm("再次确认：将删除真实关系记录并重置为中性。")) return;
            kernelEventBus.emit("RELATIONSHIP_RESET_REQUEST");
          }}
          title="RESET RELATIONSHIP（二次确认）"
          style={{
            background: "rgba(255,90,90,0.08)",
            border: "1px solid rgba(255,120,120,0.35)",
            borderRadius: 6,
            color: "#ff9a9a",
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          🔄 RESET RELATIONSHIP
        </button>
      </div>

      {/* 控制台：输入 + 身体自测（不依赖大脑） */}
      <div style={{ padding: "8px 10px" }}>
        <input
          value={input}
          disabled={thinking}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={thinking ? "思考中…" : "说点什么，回车发送"}
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(120,160,255,0.3)",
            borderRadius: 6,
            color: "#d7e3ff",
            padding: "6px 8px",
            outline: "none",
            opacity: thinking ? 0.6 : 1,
          }}
        />
      </div>

      <div style={{ padding: "0 10px 8px", display: "flex", flexWrap: "wrap", gap: 6 }}>
        <span style={{ width: "100%", color: "#6b7da0", fontSize: 11, marginBottom: 2 }}>
          Body test（不经大脑，仅验身体）
        </span>
        {BODY_TESTS.map((b) => (
          <button
            key={b.intent}
            onClick={() => bodyTest(b.intent)}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              color: "#c7d2e0",
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div style={{ padding: "0 10px 8px", color: "#6b7da0", fontSize: 10.5, lineHeight: 1.4 }}>
        断点定位：① Body测试(不经大脑) ② 输入框自然语言(看 COGNITION raw⇒normalized) ③ 若 POSE/ANIM 空白=身体端断；若 COGNITION 无 UNKNOWN/normalized 行=大脑/归一化断
      </div>

      {/* EVENT TRACE · 最近发生了什么（详细日志） */}
      <div
        style={{
          borderTop: "1px solid rgba(120,160,255,0.2)",
          padding: "6px 10px",
          overflowY: "auto",
          maxHeight: 160,
          background: "rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ color: "#8aa0c8", fontSize: 11, letterSpacing: 0.5, marginBottom: 4 }}>
          EVENT TRACE
        </div>
        {log.length === 0 ? (
          <div style={{ color: "#4a5878" }}>// 链路日志为空，从输入框发一句话试试</div>
        ) : (
          log.map((e) => (
            <div key={e.id} style={{ padding: "1px 0", color: "#9fb3d6" }}>
              <span style={{ color: "#6b7da0" }}>{e.stage.padEnd(9)}</span>
              {e.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
