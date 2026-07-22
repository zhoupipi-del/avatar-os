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
// ============================================================

import { useEffect, useRef, useState } from "react";
import { kernelEventBus, AgentSandbox } from "@avatar-os/runtime";
import type { PhysicalIntentType } from "@avatar-os/primitives";

interface StageState {
  input?: string;
  cognition?: string;
  intent?: string;
  primitive?: string;
  mood?: string;
  memory?: string;
}

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

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "3px 0",
};

function Stage({ label, value, accent }: { label: string; value?: string; accent: string }) {
  return (
    <div style={rowStyle}>
      <span style={{ width: 92, color: "#8aa0c8", flexShrink: 0 }}>{label}</span>
      <span
        style={{
          flex: 1,
          color: value ? accent : "#4a5878",
          background: value ? "rgba(255,255,255,0.04)" : "transparent",
          padding: "2px 6px",
          borderRadius: 4,
          wordBreak: "break-all",
        }}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

export function DebugConsole() {
  const [collapsed, setCollapsed] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [stages, setStages] = useState<StageState>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const logId = useRef(0);

  useEffect(() => {
    const pushLog = (stage: string, text: string) => {
      const id = ++logId.current;
      setLog((prev) => [{ id, stage, text }, ...prev].slice(0, 200));
    };

    const u1 = kernelEventBus.on("SPEECH_INPUT", (p) => {
      setStages((s) => ({ ...s, input: p.text }));
      pushLog("INPUT", `「${p.text}」`);
    });

    const u2 = kernelEventBus.on("AVATAR_THOUGHT", (p) => {
      if (p.kind === "thinking") {
        setThinking(true);
        setStages((s) => ({ ...s, cognition: "🤔 思考中…" }));
        pushLog("COGNITION", "thinking…");
      } else if (p.kind === "clear") {
        setThinking(false);
        setStages((s) => ({ ...s, cognition: undefined }));
        pushLog("COGNITION", "clear");
      } else {
        setThinking(false);
        const label = p.kind === "speech" ? "💬" : p.kind === "state" ? "📣" : "💭";
        setStages((s) => ({ ...s, cognition: `${label} ${p.text ?? ""}` }));
        pushLog("COGNITION", `${p.kind}: ${p.text ?? ""}`);
      }
    });

    const u3 = kernelEventBus.on("PHYSICAL_INTENT_DISPATCH", (p) => {
      setStages((s) => ({ ...s, intent: p.type }));
      pushLog("INTENT", p.type);
    });

    const u4 = kernelEventBus.on("AVATAR_PRIMITIVE", (p) => {
      setStages((s) => ({ ...s, primitive: `${p.type} · ${p.detail}` }));
      pushLog("POSE/ANIM", `${p.type} ${p.detail}`);
    });

    const u5 = kernelEventBus.on("STATE_MOOD_CHANGED", (p) => {
      setStages((s) => ({ ...s, mood: p.mood }));
      pushLog("MOOD", p.mood);
    });

    const u6 = kernelEventBus.on("MEMORY_APPEND", (p) => {
      setStages((s) => ({ ...s, memory: `${p.source}: ${p.content.slice(0, 24)}` }));
      pushLog("MEMORY", `${p.source}: ${p.content.slice(0, 24)}`);
    });

    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
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
        <span
          onClick={() => setCollapsed(true)}
          style={{ cursor: "pointer", color: "#8aa0c8", padding: "0 4px" }}
          title="折叠"
        >
          ▢
        </span>
      </div>

      <div style={{ padding: "8px 10px" }}>
        <Stage label="INPUT" value={stages.input} accent="#9fe6ff" />
        <Stage label="COGNITION" value={stages.cognition} accent="#ffd479" />
        <Stage label="INTENT" value={stages.intent} accent="#b69bff" />
        <Stage label="POSE/ANIM" value={stages.primitive} accent="#7dffa8" />
        <Stage label="MOOD" value={stages.mood} accent="#ff9bd0" />
        <Stage label="MEMORY" value={stages.memory} accent="#c7d2e0" />
      </div>

      <div style={{ padding: "0 10px 8px", display: "flex", gap: 6 }}>
        <input
          value={input}
          disabled={thinking}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={thinking ? "思考中…" : "说点什么，回车发送"}
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(120,160,255,0.3)",
            borderRadius: 6,
            color: "#d7e3ff",
            padding: "6px 8px",
            outline: "none",
            opacity: thinking ? 0.6 : 1,
          }}
        />
        <button
          onClick={submit}
          disabled={thinking}
          style={{
            background: "rgba(120,160,255,0.25)",
            border: "1px solid rgba(120,160,255,0.4)",
            borderRadius: 6,
            color: "#d7e3ff",
            padding: "6px 10px",
            cursor: thinking ? "default" : "pointer",
          }}
        >
          发送
        </button>
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

      <div
        style={{
          borderTop: "1px solid rgba(120,160,255,0.2)",
          padding: "6px 10px",
          overflowY: "auto",
          maxHeight: 160,
          background: "rgba(0,0,0,0.2)",
        }}
      >
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
