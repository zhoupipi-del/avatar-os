import { useEffect, useState } from "react";
import { kernelEventBus } from "@avatar-os/runtime";

interface ActiveThought {
  id: number;
  emoji: string;
  text: string;
  kind: "thought" | "state" | "speech" | "thinking";
}

/**
 * 状态/想法气泡：订阅 AVATAR_THOUGHT 事件，以毛玻璃浮泡呈现萌物的
 * "心理活动"(听/想/说/情绪/空闲想法)。多条想法快速到达时只保留最新一条，
 * 并在 durationMs 后自动淡出。气泡本身 pointer-events:none，不挡拖拽/点击。
 */
export const ThoughtBubble: React.FC = () => {
  const [thought, setThought] = useState<ActiveThought | null>(null);

  useEffect(() => {
    let counter = 0;
    const timers = new Map<number, number>();

    const unbind = kernelEventBus.on("AVATAR_THOUGHT", (p) => {
      // clear：立即清空气泡，不渲染内容
      if (p.kind === "clear") {
        setThought(null);
        return;
      }
      const id = ++counter;
      setThought({ id, emoji: p.emoji ?? "💭", text: p.text ?? "", kind: p.kind });

      // thinking：思考占位，持续显示直到被 clear 或后续 speech/thought 覆盖（不自动淡出）
      if (p.kind === "thinking") return;

      const duration = p.durationMs ?? 2600;
      const handle = window.setTimeout(() => {
        setThought((cur) => (cur && cur.id === id ? null : cur));
        timers.delete(id);
      }, duration);
      timers.set(id, handle);
    });

    return () => {
      unbind();
      timers.forEach((h) => window.clearTimeout(h));
      timers.clear();
    };
  }, []);

  if (!thought) return null;

  return (
    <div
      className={`thought-bubble thought-${thought.kind}`}
      key={thought.id}
      role="status"
      aria-live="polite"
    >
      <span className="thought-emoji">{thought.emoji}</span>
      <span className="thought-text">{thought.text}</span>
    </div>
  );
};
