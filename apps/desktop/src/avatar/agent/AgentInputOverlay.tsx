import { useEffect, useRef, useState, type ReactNode } from "react";

export interface AgentInputOverlayProps {
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly onSubmit: (text: string) => Promise<void> | void;
  readonly onInterrupt?: () => void;
  readonly busy?: boolean;
  /** 输入框左侧的附加按钮（如设置） */
  readonly leading?: ReactNode;
  /** 输入框获得焦点 / 有未发送的文字 / 正在发送时为 true（外层据此保持输入栏不隐藏） */
  readonly onActiveChange?: (active: boolean) => void;
}

export function AgentInputOverlay({
  disabled = false,
  placeholder = "和 VOID 说句话",
  onSubmit,
  onInterrupt,
  busy = false,
  leading,
  onActiveChange,
}: AgentInputOverlayProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [focused, setFocused] = useState(false);
  const submission = useRef(0);

  const active = focused || pending || text.trim().length > 0;
  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  async function submit(): Promise<void> {
    const value = text.trim();

    if (!value || disabled) {
      return;
    }

    setPending(true);
    const current = ++submission.current;

    try {
      setText("");
      await onSubmit(value);
    } finally {
      if (current === submission.current) setPending(false);
    }
  }

  const canSend = !disabled && text.trim().length > 0;
  const interrupt = () => {
    submission.current += 1;
    setPending(false);
    onInterrupt?.();
  };

  return (
    <div className="avatar-agent-input">
      {leading}
      <input
        value={text}
        disabled={disabled}
        placeholder={pending ? "可以继续输入，打断上一轮…" : placeholder}
        aria-label={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          setText(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onInterrupt && (pending || busy)) {
            event.preventDefault();
            interrupt();
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />

      {onInterrupt && (pending || busy) ? (
        <button type="button" className="avatar-agent-input__send" aria-label="停止回复" title="停止回复（Esc）" onClick={interrupt}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="2" fill="currentColor" /></svg>
        </button>
      ) : null}

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
