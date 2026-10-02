# AvatarOS Milestone 1 — 生命反射弧验收（出生证明）

> 目标：证明从「人的一句话」到「数字生命产生一个可观察行为」的**神经反射弧第一次闭合**。
> 这不是功能清单，是**存在性证明**。闭包之前不扩展任何新能力（Action Graph / Embodiment / Capability Scanner / 表情系统 / 更强模型）。

---

## 0. 启动方式

```bash
cd avatar-os
pnpm --filter desktop tauri dev
```

- 默认大脑：`qwen2.5:0.5b`（已验证可闭环）。
- 提质（推荐用于验收）：`VITE_OLLAMA_MODEL=qwen2.5:7b pnpm --filter desktop tauri dev`
  （`qwen2.5:7b` 4.7GB 已拉至 `D:\ollama-models`，输出稳定性显著优于 0.5b）。
- 程序打开后，右下角出现毛玻璃 **🐶 AvatarOS · Runtime Debug** 面板（仅 DEV 构建显示）。
- 验收全程盯这个面板 + 画布里的 `bag-character`。

### 前置依赖（已确认）
- Ollama 在跑：`127.0.0.1:11434`（进程 `ollama.exe`，模型目录 `D:\ollama-models`）。
- 若 11434 没监听：手动 `ollama serve`（需继承 `OLLAMA_MODELS=D:\ollama-models`）。

---

## 1. 验收矩阵

### Test 0 — 纯物理通路（绕过 AI）
**目的**：隔离验证 Avatar「肌肉」没问题。失败则问题在 AnimationManager / clip 映射 / GLB 播放，与 AI 无关。

- **操作**：点 DebugConsole 的 `👋 GREET` 按钮（Body test，明确标注「不经大脑」）。
- **预期**：
  - 画布里 `bag-character` 播放挥手动画（`NlaTrack.001`）。
  - DebugConsole `INTENT` 行显示 `GREET`，`POSE/ANIM` 行显示 `GREET · ...`。
  - **气泡不出现**（Body test 不经 Cognition，不说话 —— 这是正确的）。
- **断点定位**：若画布不动但 `INTENT`/`POSE/ANIM` 有值 → 肌肉端（AnimationManager / GLB clip）问题。

### Test 1 — 固定 JSON（认知层隔离）
**目的**：隔离验证 `Cognition → IntentNormalizer → Dispatch`，排除 LLM 随机性。

- **现状**：GUI 没有「注入固定 JSON」入口（遵守「不扩展能力」原则）。
- **已有覆盖**：无头真机探针 `packages/cognition/tests/live-probe.ts` 已锁死此链路 —— 构造 LLM 原始输出（如 `intent:"greeting"`）→ Normalizer → `PHYSICAL_INTENT_DISPATCH`，3/3 次稳定闭环。
- **GUI 等价做法**：直接做 Test 2，观察 Trace 里 `INTENT(raw)` 行的 `raw⇒normalized` 是否被正确归一（如 `greeting ⇒ GREET`）。

### Test 2 — 真实 Ollama（端到端）
**目的**：真实语言刺激 → 身体响应，完整反射弧。

- **操作**：DebugConsole 输入框打「你好呀，小家伙」回车。
- **预期 Trace（自上而下）**：
  ```
  [INPUT]        「你好呀，小家伙」
  [COGNITION]    💬 <LLM 说出的话>
  [INTENT(raw)]  greeting ⇒ GREET        ← Normalizer 证据（UNKNOWN⚠ 说明需补别名）
  [INTENT]       GREET
  [POSE/ANIM]    GREET · <clip/detail>
  [MOOD]         <情绪>
  [MEMORY]       user: 你好呀… / avatar: …
  ```
- **画布**：`bag-character` 播 GREET 动画 + 气泡出字。
- **断点定位**：
  - `INTENT(raw)` 空白 → 大脑 / Normalizer 断（Ollama 没响应或输出无法解析）。
  - `INTENT` 有值但 `POSE/ANIM` 空白 → BehaviorVM / AnimationManager 断。
  - `POSE/ANIM` 有值但画布不动 → GLB 动画播放 / 皮肤挂载断。

---

## 2. 通过标准 Checklist（全部打勾 = Milestone 1 完成）

- [ ] **输入进入系统**：DebugConsole `INPUT` 行出现用户输入文本。
- [ ] **LLM 产生决策**：`COGNITION` 行出现 `💬` 说话内容（非仅 🤔 思考中）。
- [ ] **Intent 归一化**：`INTENT(raw)` 行显示 `raw ⇒ normalized`，且 `matched=true`（或 `UNKNOWN⚠` 被记录进日志待训练）。
- [ ] **PHYSICAL_INTENT_DISPATCH 出现**：`INTENT` 行显示 `GREET`（或对应意图）。
- [ ] **BehaviorVM 收到**：`POSE/ANIM` 行出现对应 primitive（如 `GREET · ...`）。
- [ ] **GLB 动画播放**：画布里 `bag-character` 肉眼可见地播了对应动作（挥手 / 伸懒腰 / 歪头等）。
- [ ] **气泡同步**：角色头顶气泡出现 LLM 说的话，与 `COGNITION` 行一致。

> Test 0 覆盖第 5–6 项（物理通路）；Test 2 覆盖第 1–7 项（端到端）。

---

## 3. 已知限制 / 本里程碑明确不做

- **`AvatarFSM.scheduleReset` 使用 `window.setTimeout`**：仅在 node 测试环境报 `window is not defined`，**真实 Tauri/WebView 中无碍**。属工程卫生问题（Option B），不阻塞生命闭环，延后处理。
- **`IDLE_BREATHE` / `HEAD_TILT` 常驻显示**：系统默认呼吸基线 + 微动作，是真实事件，非 bug。
- **呼吸 / LookAt / 微动作节律 / 表情系统**：属「生命感增强层」（Option C），不在本里程碑。先拿到「出生证明」，再加「生命感」。
- **7b/14b 更强模型**：非必须。0.5b 已验证可闭环；7b 已拉可用于提质，不引入新抽象。

---

## 4. 验收结论签名

| 项 | 值 |
|---|---|
| 版本 | `feature/3d-rigged` @ `ed2e8a6` |
| 大脑模型 | `qwen2.5:0.5b`（或 `7b`） |
| 信号层验证 | ✅ 99 单测 + 桌面构建绿 + 无头探针 3/3 闭环 |
| 视觉验收 | ☐ 待 BOSS 本地 `tauri dev` 肉眼勾选（Test 0 + Test 2） |
| 出生证明 | ☐ 七项全勾后签发 |

---

*本文件即 Milestone 1 的「出生证明」存根。视觉验收由运行环境（有显示器的桌面）完成，无头 CI 只负责信号层。*
