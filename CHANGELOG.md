# Changelog — AvatarOS

版本号遵循 `v<主>.<副>.<补丁>`。`<副>` 进位 = 一次"状态切换"级里程碑。

---

## v0.3.1 — 可观察产品态（Visual Hygiene Patch） · 2026-07-22

**状态切换：开发态 AvatarOS → 可观察产品态 AvatarOS**

本版本只有 1 行功能改动，但完成了一个重要的工程状态切换：开发工具退出视觉主舞台，
把"会显示 AI 回复的 3D 界面"变成"有输入、有认知、有行为、有身体反馈的运行时"。

### 完成的三大稳定闭环
- **神经闭环** ✅ `用户输入 → SPEECH_INPUT → Cognition → IntentNormalizer → PHYSICAL_INTENT_DISPATCH → BehaviorVM`
- **肌肉闭环** ✅ `BehaviorVM → AnimationManager → GLB Rig → NLA Clip → Avatar 动作`
- **表达闭环** ✅ `Cognition Response → Speech → ThoughtBubble`

### 改动
- `DebugConsole` 默认 `collapsed=true`：启动即呈 `🐶 OS·DBG` 小按钮，开发工具不再污染用户视野。
  Developer Mode 与 User Mode 分离（展开态 Runtime Trace 功能完全不变）。
- 此前已落地的支撑（本版本之前）：RuntimeKernel（生命周期编排）、IntentNormalizer（观察优先三层归一化，
  NONE/UNKNOWN 语义区分）、Agent Trace（INTENT_NORMALIZED 事件）、OllamaProvider 字段修复（取 `response` 而非 `message.content`）。

### 真实环境数据（用于后续表现层调参，非 bug）
- Tauri 窗口 220×220；Avatar root 180×220；Canvas 150×180；bag-character 模型占 Canvas ≈80%（fitHeight=2.6 刻意撑满取景框）。
- 本地 Ollama 已装（`D:\ollama-models`）：`qwen2.5:0.5b`（兜底）/ `qwen2.5:7b`（验收提质）。

### 已知限制（延后到后续版本）
- `AvatarFSM.scheduleReset` 用 `window.setTimeout`（浏览器全局），node 测试环境会报 `window is not defined`；真实 Tauri 无碍。
- 动画片段名仍为 Blender 导出残留名（NlaTrack/NlaTrack.001/NlaTrack.002），无语义——见 v0.3.2。

---

## v0.3.1.1 — Runtime State Snapshot（只读生命体监护仪）· 2026-07-22

**给生命体装一个"心电监护仪"——只采集已有状态，绝不创造状态、绝不控制行为。**

边界在此版本被【再次收紧】，逐条冻结：
- ❌ 不新增 Store / Redux / Zustand（无订阅 API、无响应式）
- ❌ 不新增 EventBus（只订阅已存在的 `kernelEventBus`）
- ❌ 不修改 Cognition / BehaviorVM / AvatarAdapter（零逻辑改动）
- ❌ 不做轮询（无 `setInterval` 刷新，纯事件驱动：哪里发生事件，哪里留痕）
- ❌ 不写回任何状态

### 实现（旁路只读）
- 新增 `packages/runtime/src/agent-runtime-snapshot.ts`：定义 `AgentRuntimeSnapshot` 接口 +
  纯函数式写入（`recordIntent/recordSpeech/recordAction/recordClip/recordMood`）。
  这是一个**数据容器**，不是状态管理系统——无 `SnapshotManager` 的 `restoreState` 写回，
  与崩溃恢复的 `snapshot-manager.ts` 明确划清界限（v0.3.1.1 不碰它）。
- `DebugConsole` 的 LIVE STATE 面板改为订阅事件并经上述纯函数写入：
  - `cognition.lastIntent` ← `INTENT_NORMALIZED.normalized`
  - `cognition.speech`     ← `AVATAR_THOUGHT(speech)`
  - `behavior.currentAction` ← `PHYSICAL_INTENT_DISPATCH.type`
  - `behavior.currentClip` / `avatar.animation` ← `AVATAR_PRIMITIVE` 的 `detail="clip=NlaTrack.001"`
    （动画片段一旦派发到身体即视为"playing"；不改 `AnimationManager`，AvatarAdapter 保持冻结）
  - `avatar.mood` ← `STATE_MOOD_CHANGED.mood`

### 两个"先验真"纠偏
- **不存在 `COGNITION_DECISION` 事件**：规格初稿假设了它，但事件总线里没有。
  按"先验真、再改代码"原则，不虚构事件，改用真实存在的 `INTENT_NORMALIZED` 作为认知侧事实源。
- **`confidence` 不编造**：Cognition 引擎当前不产出置信度。类型定义为 `number | null`，
  字段恒定保持 `null`——绝不塞一个假数字。真实环境一旦在事件里携带置信度，此处即填充，无需改结构。

### 展示
- LIVE STATE 置于标题正下方、EVENT TRACE 上方；纯文本、无颜色、无状态指示灯。
  顺序：`Intent / Speech / Action / Clip / Avatar(playing|idle) / Mood`。
- 关闭 DebugConsole 完全不影响 Avatar（快照是旁路，不回写、不驱动任何行为）。

### 验证
- 新增 `agent-runtime-snapshot.spec.ts`（5 例）锁死"采集不创造"契约，
  含 `confidence` 恒为 `null`、`recordClip` 同源驱动 `currentClip` 与 `animation`、写入纯函数不可变性。

---

## 后续路线图（已与 BOSS 对齐）
```
✅ v0.3.1    Debug 收敛，退出视觉主舞台
↓ 🔜 v0.3.1.1 Runtime State Snapshot（只读监护仪）
↓ 🔜 v0.3.2   Animation Inspector（标定 NLA 片段语义：idle/greet/celebrate）
↓ 🔜 v0.3.3   Procedural Idle（呼吸 / 轻微摆动）
↓ 🔜 v0.4     Head Bone LookAt
```
原则：先让每个行为**可信、可解释**，再谈"像生命"。
