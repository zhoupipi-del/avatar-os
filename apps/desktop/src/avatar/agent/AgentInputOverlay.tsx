import { useState } from "react";

export interface AgentInputOverlayProps {
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly onSubmit: (text: string) => Promise<void> | void;
}

export function AgentInputOverlay({
  disabled = false,
  placeholder = "和 VOID 说句话",
  onSubmit,
}: AgentInputOverlayProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    const value = text.trim();

    if (!value || pending || disabled) {
      return;
    }

    setPending(true);

    try {
      setText("");
      await onSubmit(value);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="avatar-agent-input">
      <input
        value={text}
        disabled={disabled || pending}
        placeholder={pending ? "思考中..." : placeholder}
        aria-label="Agent input"
        onChange={(event) => {
          setText(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />

      <button
        type="button"
        disabled={disabled || pending || !text.trim()}
        onClick={() => void submit()}
      >
        发送
      </button>
    </div>
  );
}
