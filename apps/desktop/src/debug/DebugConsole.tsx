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
  recordAvatarProfile,
  type AgentRuntimeSnapshot,
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

    // —— 身体侧（当前激活 profile，事实在 AvatarService，此处只读镜像）——
    const uAvatar = avatarService.subscribe((s) => {
      setSnapshot((snap) => recordAvatarProfile(snap, s.activeId));
    });

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
      uAvatar();
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
        <LiveRow label="Clip" value={snapshot.behavior.currentClip} />
        <LiveRow label="Avatar" value={snapshot.avatar.animation ? "playing" : "idle"} />
        <LiveRow label="Body" value={snapshot.avatar.activeAvatarId} />
        <LiveRow label="Mood" value={snapshot.avatar.mood} />
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
