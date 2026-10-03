import { useEffect, useState, type ReactNode } from "react";

export interface AgentInputOverlayProps {
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly onSubmit: (text: string) => Promise<void> | void;
  /** 输入框左侧的附加按钮（如设置） */
  readonly leading?: ReactNode;
  /** 输入框获得焦点 / 有未发送的文字 / 正在发送时为 true（外层据此保持输入栏不隐藏） */
  readonly onActiveChange?: (active: boolean) => void;
}

export function AgentInputOverlay({
  disabled = false,
  placeholder = "和 VOID 说句话",
  onSubmit,
  leading,
  onActiveChange,
}: AgentInputOverlayProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [focused, setFocused] = useState(false);

  const active = focused || pending || text.trim().length > 0;
  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

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

  const canSend = !disabled && !pending && text.trim().length > 0;

  return (
    <div className="avatar-agent-input">
      {leading}
      <input
        value={text}
        disabled={disabled || pending}
        placeholder={pending ? "他在想…" : placeholder}
        aria-label={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
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
        className="avatar-agent-input__send"
        disabled={!canSend}
        aria-label="发送"
        title="发送（回车）"
        onClick={() => void submit()}
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <path d="M3.4 10.6 16 4.8c.5-.2 1 .3.8.8L11 18.2c-.2.5-1 .5-1.1-.1l-1.3-5.4a.6.6 0 0 0-.4-.4L2.9 11c-.6-.1-.6-.9-.1-1.1z" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
