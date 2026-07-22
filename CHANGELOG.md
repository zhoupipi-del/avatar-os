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

## v0.3.1.1 — Runtime State Snapshot（规划中，未发布）

**目标：给生命体装一个"心电监护仪"——只读、不改变逻辑。**

- 在 DebugConsole 展开态顶部新增 `LIVE STATE` 只读面板，从现有事件订阅派生当前快照：
  `Intent / Action / Clip / Speech / Mood / Match(✅|⚠ UNKNOWN)`。
- **不引入 `confidence`**：当前 Cognition 引擎不产出置信度，以 normalizer 的 `matched` 布尔作为诚实替代。
- 复用既有 `snapshot-manager.ts`（`driveEngine.getState()` / `avatarFSM.getMood()`）作为结构化状态源的可选扩展方向，但 v0.3.1.1 不重造模块。

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
