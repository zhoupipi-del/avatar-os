// ============================================================
// AnimationInspector — v0.3.2 NLA 剪辑肉眼标定面板
// ============================================================
// 设计纪律（与 v0.3.1.1 LIVE STATE 一致）：
// - 纯旁路、只读扫描：不碰 StandardAvatarSkin / RiggedGLBSkin 内部的
//   engineRef/mixer，自己经 useAvatarLoader 独立加载 + 建 AnimationManager，
//   与生产渲染树完全隔离，不存在"两个 mixer 抢同一份 actions"的风险。
// - 不写回内核：标定结果只落成可复制的 JSON，人工核对后手动回填
//   BAG_CONFIG.intentClip / idleClip —— 不做自动写文件/热更配置，避免引入状态污染。
// - clip 名单/时长口径与运行时同源：直接读 useAvatarLoader 解析出的
//   capabilities.availableClips（= avatarLoader.ts 里那批 AnimationClip 的同一数据）。
// - 取景观感与生产一致：复用 useAvatarLoader 的 transform（包裹 group 缩放/居中），
//   与 StandardAvatarSkin 同一套取景算法，标定看到的就是用户看到的生产画面。
//
// 挂载：本组件不自带挂载，由调用方（DEV 态）按需渲染，例如挂到 DebugConsole 旁。
// 见文件末尾「挂载示例」注释。

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useAvatarLoader } from "./avatarLoader";
import { BAG_CONFIG } from "./RiggedGLBSkin";
import { AnimationManager } from "@avatar-os/runtime";

// 模型路径直接复用 BAG_CONFIG.url —— 以后换模型只改 RiggedGLBSkin 一处，
// 这里自动跟着改，不用两处记。（原 TODO① 已消解）
const MODEL_URL = BAG_CONFIG.url;

// 标定角色：与 BAG_CONFIG.intentClip 的键严格对齐（大写 PhysicalIntentType），
// 外加 idle（落入独立 idleClip 字段）与 unassigned（不输出）。
// 注意：BAG_CONFIG.intentClip 当前只映射这 4 个意图；IDLE_BREATHE / LOOK_AT_USER /
// PEEK 暂不在 intentClip 合约内，故不在此提供选择项（避免产出无法回填的键）。
// 运行时按 config.intentClip["GREET"] 大写查表，故键必须大写，小写会静默不播。
type SemanticRole = "idle" | "GREET" | "BOUNCE_HAPPY" | "STRETCH" | "DOZE" | "unassigned";

const ROLE_OPTIONS: SemanticRole[] = ["idle", "GREET", "BOUNCE_HAPPY", "STRETCH", "DOZE"];

interface ClipInfo {
  name: string;
  duration: number;
}

interface ReadyPayload {
  clips: ClipInfo[];
  manager: AnimationManager;
}

/**
 * 独立加载模型 + 建自己的 AnimationManager。
 * 复用 useAvatarLoader（与生产一致的取景/材质修复/能力探测），产出 transform
 * 交给包裹 group，零风险改动生产渲染路径。
 */
function InspectorModel({ onReady }: { onReady: (p: ReadyPayload) => void }) {
  const { scene, mixer, actions, transform, capabilities } = useAvatarLoader(
    MODEL_URL,
    BAG_CONFIG.fitHeight,
  );
  const managerRef = useRef<AnimationManager | null>(null);
  const reportedRef = useRef(false);

  // 副作用放 useEffect：建 Manager 并经 onReady 通知父组件（原先用 useMemo 做
  // 副作用，会在渲染期改父 state，违反 React 规则）。
  useEffect(() => {
    const manager = new AnimationManager(mixer, actions, {
      idleClip: BAG_CONFIG.idleClip,
    });
    managerRef.current = manager;

    if (!reportedRef.current) {
      reportedRef.current = true;
      onReady({
        clips: capabilities.availableClips.map((c) => ({ name: c.name, duration: c.duration })),
        manager,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixer, actions, capabilities]);

  useFrame((_, delta) => {
    managerRef.current?.tick(delta);
  });

  return (
    <group scale={transform.scale} position={transform.position}>
      <primitive object={scene} />
    </group>
  );
}

export function AnimationInspector() {
  const [clips, setClips] = useState<ClipInfo[]>([]);
  const [manager, setManager] = useState<AnimationManager | null>(null);
  const [roles, setRoles] = useState<Record<string, SemanticRole>>({});
  const [playing, setPlaying] = useState<string | null>(null);

  const handleReady = (payload: ReadyPayload) => {
    setClips(payload.clips);
    setManager(payload.manager);
  };

  const play = (name: string) => {
    setPlaying(name);
    // playOnce 查不到会静默不播（AnimationManager.resolve 行为），
    // 这里不额外加提示——查不到本身就是"这个名字不对"的信号，
    // 该让人回去核对 clip 名单，而不是被面板掩盖掉。
    manager?.playOnce(name, () => setPlaying((p) => (p === name ? null : p)));
  };

  const setRole = (clip: string, role: SemanticRole) => {
    setRoles((prev) => ({ ...prev, [clip]: role }));
  };

  // 纯派生：idle 角色 → idleClip 字段；大写意图角色 → intentClip 映射。
  // 同一角色只保留最后一次指定；冲突由 JSON 预览如实反映（后选覆盖先选）。
  // 输出形状与 BAG_CONFIG（RigConfig）的 { idleClip, intentClip } 直接对齐，
  // 复制后整段替换 BAG_CONFIG 对应字段即可。
  const { idleClip, intentClip } = useMemo(() => {
    let idle: string | undefined;
    const map: Record<string, string> = {};
    for (const [clip, role] of Object.entries(roles)) {
      if (role === "unassigned") continue;
      if (role === "idle") {
        idle = clip;
        continue;
      }
      map[role] = clip;
    }
    return { idleClip: idle, intentClip: map };
  }, [roles]);

  const mappingJSON = JSON.stringify(
    {
      model: MODEL_URL.split("/").pop(),
      idleClip: idleClip ?? "",
      intentClip,
    },
    null,
    2,
  );

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "monospace", fontSize: 13 }}>
      <div
        style={{
          width: 340,
          background: "#111",
          color: "#0f0",
          overflowY: "auto",
          padding: 12,
          boxSizing: "border-box",
        }}
      >
        <div style={{ marginBottom: 12, color: "#888", lineHeight: 1.5 }}>
          Animation Inspector — 纯旁路扫描面板
          <br />
          不写回内核，标定结果需手动回填 BAG_CONFIG.intentClip / idleClip
        </div>
        <button
          onClick={() => (location.search = "")}
          style={{ marginBottom: 12 }}
        >
          ← 返回 Avatar
        </button>

        {clips.length === 0 && <div>扫描中…（等 GLB 加载）</div>}

        {clips.map((c) => (
          <div
            key={c.name}
            style={{
              border: "1px solid #333",
              borderRadius: 4,
              padding: 8,
              marginBottom: 8,
              background: playing === c.name ? "#1a2e1a" : "transparent",
            }}
          >
            <div style={{ marginBottom: 6 }}>
              <b>{c.name}</b>{" "}
              <span style={{ color: "#888" }}>({c.duration.toFixed(2)}s)</span>
            </div>
            <button onClick={() => play(c.name)} style={{ marginRight: 8 }}>
              ▶ Play
            </button>
            <select
              value={roles[c.name] ?? "unassigned"}
              onChange={(e) => setRole(c.name, e.target.value as SemanticRole)}
            >
              <option value="unassigned">未标定</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        ))}

        <div style={{ marginTop: 16, marginBottom: 6, color: "#888" }}>
          标定产物（人工核对后再回填 BAG_CONFIG.intentClip / idleClip）：
        </div>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "#000",
            padding: 8,
            border: "1px solid #333",
            borderRadius: 4,
          }}
        >
          {mappingJSON}
        </pre>
        <button onClick={() => navigator.clipboard.writeText(mappingJSON)}>复制 JSON</button>
      </div>

      <div style={{ flex: 1 }}>
        <Canvas
          camera={{ position: [0, 0.3, 5], fov: 35 }}
          gl={{ alpha: true, antialias: true }}
          style={{ width: "100%", height: "100%", background: "#222" }}
        >
          <ambientLight intensity={0.8} />
          <directionalLight position={[3, 5, 4]} intensity={1.3} />
          <directionalLight position={[-3, 2, -2]} intensity={0.45} />
          <Suspense fallback={null}>
            <InspectorModel onReady={handleReady} />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}

/*
 * ============================================================
 * 挂载示例（DEV 态，入口放在 DebugConsole 旁，但渲染用「替换」而非「共存」）
 * ============================================================
 * ⚠️ 关键约束：drei 的 useGLTF 按 URL 全局缓存同一份 scene 对象。若 <Avatar/>
 *    与 <AnimationInspector/> 同时挂载，两者会争用同一个 Object3D——
 *    R3F 的 <primitive object={scene}> 会把同一对象从生产画布拽到 Inspect 画布
 *    （three 的 add() 会先 detach 旧 parent），导致生产 Avatar 被掏空 / Inspect
 *    黑屏，且两个 AnimationManager 抢同一副骨骼。因此 Inspect 开启时必须「替换」
 *    Avatar，绝不能两者并存。
 *
 * 1) App.tsx 用一个 DEV 只读开关决定渲染谁（不引入新状态管理，仅读 URL query）：
 *      const inspect = import.meta.env.DEV &&
 *        new URLSearchParams(location.search).has("inspect");
 *      return (
 *        <main ...>
 *          {inspect ? <AnimationInspector /> : <Avatar />}
 *          {import.meta.env.DEV && <DebugConsole />}
 *        </main>
 *      );
 *
 * 2) DebugConsole「旁」加入口（折叠按钮行 / 展开头部任意处）：
 *      <button onClick={() => (location.search = "inspect=1")} title="动作标定">
 *        🎞 INSPECT
 *      </button>
 *    点它就跳到 inspect 模式（DEV 下 HMR 重载，Avatar 被替换、无共存冲突）。
 *    退出：把 URL 里的 inspect=1 去掉刷新；或在 Inspector 内放「返回」按钮做
 *    `location.search = ""`。
 *
 * 这样 Inspect 与生产 Avatar 永不同时存在，彻底规避共享 scene / 双 mixer 风险，
 * 且仍由 DebugConsole 提供「旁边」的入口，符合 v0.3.1.1「不新增状态管理」纪律。
 */
