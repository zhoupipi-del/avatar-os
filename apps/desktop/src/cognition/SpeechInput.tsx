// ============================================================
// SpeechInput — 混合双模态输入 (建议一·子任务A, 形态C)
// ============================================================
// 低侵入、高响应：平时只留一个极简启动器；Ctrl/Cmd+K 或点启动器唤起
// 毛玻璃输入条。回车/点发送向总线发射 SPEECH_INPUT，长文本由气泡承接。
//
// 思考态联动：订阅 AVATAR_THOUGHT——
//   kind="thinking" → 输入框置灰 + placeholder 显示"思考中…"
//   kind="clear"/"speech" → 恢复可输入
// 这是"大脑在想"的真实反馈，而非假 loading。
// ============================================================

import { useEffect, useRef, useState } from "react";
import { kernelEventBus } from "@avatar-os/runtime";

const HOTKEY = "k"; // Ctrl/Cmd + K

export function SpeechInput() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 全局热键 Ctrl/Cmd + K 切换抽屉（形态C：双击/热键双入口之一）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === HOTKEY) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 思考态联动：仅订阅真实总线事件，不轮询、不 mock
  useEffect(() => {
    const off = kernelEventBus.on("AVATAR_THOUGHT", (p) => {
      if (p.kind === "thinking") setThinking(true);
      else if (p.kind === "clear" || p.kind === "speech") setThinking(false);
    });
    return off;
  }, []);

  // 抽屉展开自动聚焦
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    kernelEventBus.emit("SPEECH_INPUT", { text: trimmed, timestamp: Date.now() });
    setText("");
    setOpen(false); // 收起，交给气泡承接后续长文本
  };

  if (!open) {
    // 常驻极简启动器（形态C：点击入口）
    return (
      <button
        onClick={() => setOpen(true)}
        title="和二狗子说话 (Ctrl/⌘ + K)"
        style={launcherStyle}
      >
        💬
      </button>
    );
  }

  return (
    <div style={panelStyle} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <input
        ref={inputRef}
        value={text}
        disabled={thinking}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={thinking ? "思考中…" : "说点什么… (回车发送 · Esc 收起)"}
        style={inputStyle(thinking)}
      />
      <button onClick={submit} disabled={thinking} style={sendStyle} title="发送">
        发送
      </button>
    </div>
  );
}

// ---------- 样式（毛玻璃低侵入）----------

const launcherStyle: React.CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 16,
  width: 40,
  height: 40,
  borderRadius: "50%",
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(20,20,28,0.55)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  color: "#fff",
  fontSize: 18,
  cursor: "pointer",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
};

const panelStyle: React.CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 16,
  display: "flex",
  gap: 8,
  padding: 10,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(20,20,28,0.62)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
  zIndex: 9999,
};

function inputStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 240,
    padding: "8px 10px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.12)",
    background: disabled ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.10)",
    color: "#fff",
    fontSize: 13,
    outline: "none",
    opacity: disabled ? 0.6 : 1,
  };
}

const sendStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 9,
  border: "none",
  background: "#4f7cff",
  color: "#fff",
  fontSize: 13,
  cursor: "pointer",
};

export default SpeechInput;
