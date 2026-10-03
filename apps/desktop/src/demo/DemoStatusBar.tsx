/**
 * Day15A 演示启动自检状态条
 *
 * 聚合 5 个「真实」运行时信号，不伪造状态：
 *  - vrmLoaded：VRM 模型已挂载（VoidVrmSkin 的 vrm state）
 *  - brainReady / brainState：AgentRuntime 已接线；绿=LLM 在线，橙=规则回退，灰=探测中
 *  - ttsAvailable：浏览器语音合成可用
 *  - lipAvailable：嘴型通道探测成功
 *  - viteConnected：当前处于 Vite dev（DEV=true）
 */
export interface DemoStatusBarProps {
  readonly vrmLoaded: boolean;
  readonly brainReady: boolean;
  /** 大脑三态：ok=LLM 在线；warn=规则回退；wait=探测中。缺省按 brainReady 推断 */
  readonly brainState?: "ok" | "warn" | "wait";
  readonly brainTitle?: string;
  readonly ttsAvailable: boolean;
  readonly lipAvailable: boolean;
  readonly viteConnected: boolean;
}

interface ChipSpec {
  readonly label: string;
  readonly state: "ok" | "warn" | "wait";
  readonly title?: string;
}

const okOrWait = (ok: boolean): ChipSpec["state"] => (ok ? "ok" : "wait");

export function DemoStatusBar(props: DemoStatusBarProps) {
  const chips: ChipSpec[] = [
    { label: "VRM", state: okOrWait(props.vrmLoaded) },
    {
      label: "Brain",
      state: props.brainState ?? okOrWait(props.brainReady),
      title: props.brainTitle,
    },
    { label: "TTS", state: okOrWait(props.ttsAvailable) },
    { label: "Lip", state: okOrWait(props.lipAvailable) },
  ];
  // Vite 灯只在开发构建有意义；生产包里恒为"未连接"会误导用户
  if (import.meta.env.DEV) {
    chips.push({ label: "Vite", state: okOrWait(props.viteConnected) });
  }
  return (
    <div className="avatar-demo-status-bar">
      {chips.map((chip) => (
        <span
          key={chip.label}
          title={chip.title}
          className={"avatar-demo-status-chip avatar-demo-status-chip--" + chip.state}
        >
          <span className="avatar-demo-status-chip__dot" />
          {chip.label}
        </span>
      ))}
    </div>
  );
}
