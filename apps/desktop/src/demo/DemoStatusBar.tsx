/**
 * Day15A 演示启动自检状态条
 *
 * 聚合 5 个「真实」运行时信号，不伪造状态：
 *  - vrmLoaded：VRM 模型已挂载（VoidVrmSkin 的 vrm state）
 *  - brainReady：AgentRuntime 已接线（window.__avatarOSAgent 存在）
 *  - ttsAvailable：浏览器语音合成可用
 *  - lipAvailable：嘴型通道探测成功
 *  - viteConnected：当前处于 Vite dev（DEV=true）
 */
export interface DemoStatusBarProps {
  readonly vrmLoaded: boolean;
  readonly brainReady: boolean;
  readonly ttsAvailable: boolean;
  readonly lipAvailable: boolean;
  readonly viteConnected: boolean;
}

interface ChipSpec {
  readonly label: string;
  readonly ok: boolean;
}

export function DemoStatusBar(props: DemoStatusBarProps) {
  const chips: ChipSpec[] = [
    { label: "VRM", ok: props.vrmLoaded },
    { label: "Brain", ok: props.brainReady },
    { label: "TTS", ok: props.ttsAvailable },
    { label: "Lip", ok: props.lipAvailable },
    { label: "Vite", ok: props.viteConnected },
  ];
  return (
    <div className="avatar-demo-status-bar">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={
            "avatar-demo-status-chip" +
            (chip.ok ? " avatar-demo-status-chip--ok" : " avatar-demo-status-chip--wait")
          }
        >
          <span className="avatar-demo-status-chip__dot" />
          {chip.label}
        </span>
      ))}
    </div>
  );
}
