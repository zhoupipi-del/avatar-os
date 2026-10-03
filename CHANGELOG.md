# Changelog — AvatarOS

版本号遵循 `v<主>.<副>.<补丁>`。`<副>` 进位 = 一次"状态切换"级里程碑。

---

## v0.4.3 — 换形象：选个文件就行 · 2026-10-03

目标：不会 3D 的人，也能在 10 分钟内给任何一个人换上他自己的形象。

- **⚙ → 形象 → 更换形象**：选一个 `.vrm` 文件即可。先完整解析 + 体检，能用才换；不能用原样报错，不动当前形象。
  导入的模型存在本机应用数据目录（覆盖安装不丢），不用改程序目录、不用重新编译；可一键「恢复默认形象」；加载失败自动退回默认形象并说明原因。
- **表情自动补全**（`vrm/expression-synth.ts`）：照片生成的写实模型、Blender 自制模型常常只有 ARKit 面部变形（eyeBlinkLeft、jawOpen…）
  或 viseme_aa 一类口型，没有 VRM 标准表情 → 嘴不动、不眨眼。现在加载时按配方自动拼出 blink / aa·ih·ou·ee·oh / 喜怒哀乐，
  优先用专门的口型变形，其次 ARKit 组合；同名变形分布在多个网格（脸 / 牙 / 舌）时全部绑定；模型原有且有效的表情一律不动，空表情会被替换。
- **体检单**（`model-health.ts`）：用大白话列出身体骨骼 / 眨眼 / 说话口型 / 表情各自是「正常」「已自动生成」还是「没有」，缺必要骨骼的模型拒绝导入。
- **「试一下」**：用真实的朗读 + 嘴型 + 表情 + 挥手链路说一句话，换完马上看效果。

### 验证
- 新增 10 个单测（ARKit / viseme 配方、优先级、多网格绑定、不覆盖原有表情、替换空表情、做不到时如实报告、体检文案）。
- 浏览器实测：损坏文件被拒且形象不变；把默认模型改造成「无标准表情、只有 ARKit 风格变形」的测试模型 → 导入成功，眨眼 / 口型显示「已自动生成」，
  「试一下」时嘴型确实在动；刷新后保留；恢复默认正常。

---

## v0.4.2 — 界面：平时只有人 · 2026-10-03

真机反馈「界面很一般」后的视觉重做（只改界面层，不碰对话 / 声音 / 动作逻辑）。

- **平时只显示小人**：输入栏和设置按钮合进一个圆角输入条，鼠标移到窗口上才淡入，离开 2.5 秒收起；正在输入、等回复、开着设置时保持显示。
- **来自他的消息**：回复改为头顶白色气泡，标注他的名字、尖角指向头部，在深色 / 浅色背景上都清晰；替换原先压在身上的深色条。
- **技术指示灯（VRM / Brain / TTS / Lip）只在调试模式显示**；正常使用时仅当大模型连不上才在输入条上方给一行说明（主动选择「离线固定回复」时不提示）。
- 去掉 VRM 身体下旧 2D 皮肤遗留的「摸摸它」隐形按钮（Windows 上会露出小方框）；闲时小心思只显示文字（缺彩色 emoji 字体的系统会显示成方框）。
- 设置面板加深色底板，盖住小人时文字仍清楚；图标改为内联 SVG；键盘焦点可见；尊重「减少动态效果」系统设置。

---

## v0.4.1 — 会走动、会做你的招牌动作 · 2026-10-03

### 在桌面上走动
- `companion/desktop-walker.ts`：空闲时每 4–10 分钟在当前显示器**工作区**内横向散步（不进任务栏、不出屏幕，高 DPI 按缩放换算）。
  她按鼠标 / 打字、智能体开始思考或说话、困倦 / 睡着时不走，正在走的立刻停。⚙ → 主动陪伴可关（`VITE_COMPANION_WALK`）。
- `avatar/vrm/walk-cycle.ts`：程序化步态，不需要走路动画文件——大腿交替摆动、迈步腿膝盖后屈、手臂反向摆、躯干轻扭，
  起步 / 收步 0.3 秒渐变；身体转向行进方向（3/4 侧身），停下转回正面。
  叠加每帧撤销（`restoreGait`），未被待机动画驱动的骨骼不会累积漂移。VRM 0.x 自动翻转轴向。
- 新增权限 `core:window:allow-set-position`（仅移动自己的窗口）。

### 你的招牌动作
- `public/avatars/void/animations/custom/`：放 `.vrma` + `motions.json`（id / 文件 / 中文名 / 何时做 / 空闲权重），无需改代码。
- 已加载的招牌动作自动写进聊天提示词；回复带 `"motion":"HEART"` 时播放它代替普通动作，身体没有该动作则退回普通动作。
- `idleWeight > 0` 的动作空闲时每 6–15 分钟可能自己做一次。
- 清单校验：id 规范、不撞内置动作、文件名不允许路径穿越、最多 16 个；单个文件坏了只跳过它（`loadExtraVrmActions` 用 allSettled），不影响内置动作。
- 调试：`__avatarOSAgent.walk()` / `.playMotion(id)` / `.customMotions()`。

### 验证
- 新增 17 个单测（散步规划 / 边界 / DPI / 打断 / 失败兜底、步态交替与膝盖方向、渐入渐出、清单校验、权重抽取、提示词注入、motion 解析与回退）。
- 浏览器实测：走路帧（侧身、后腿屈膝、摆臂）→ 停下转回正面；有效招牌动作加载并播放，路径穿越条目被拒、缺失文件被跳过。
- 三道闸门 + `tauri build --no-bundle`（含 npm↔crate 版本校验）通过。

---

## v0.4.0 — Companion Mode（陪伴模式）· 2026-10-03

**状态切换：本地 Ollama 演示 → 不装模型、长得像你、说话像你、用你的声音，每天陪在她桌面上**

落地步骤见 `docs/companion-guide.md`。

### 云端大模型
- 新增 `OpenAICompatibleProvider`（OpenAI Chat Completions 兼容），预设 DeepSeek（`deepseek-flash`，JSON 模式）/ 通义千问（百炼兼容模式）/ 自定义；
  401/402/404/429 等错误转成可读中文提示，显示在 Brain 灯悬停与「测试连接」里。
- `CompanionBrain`：按设置实时切换云端 / 本机 Ollama / 离线规则，换 Key、改人设不用重启或重建 3D 引擎。
- Tauri `http:default` 放行 DeepSeek / 阿里云 / Moonshot / 智谱 / 火山方舟域名（经 Rust 侧请求，无 CORS 问题）。

### 人设 = 你
- `companion/persona.example.md` 模板 → 复制为 `persona.local.md`（已 gitignore）写真实人设；⚙ 里也可直接编辑覆盖。
- 系统提示词每次现算：人设 + 你的名字 + 怎么称呼她 + 当前日期 / 星期 / 时段（会说早安、催睡觉、记得纪念日）。
- 主动说话不再是写死的「二狗子」桌宠人设：`CognitionEngine` 新增 `persona` 选项，并带上最近 8 条聊天作为上下文。
- 输入框提示随名字变化（「和 阿杰 说句话」）。

### 你的声音（云端克隆）
- `companion/cloud-voice.ts`：OpenAI 兼容 `POST /audio/speech`（默认硅基流动 `FunAudioLLM/CosyVoice2-0.5B`）+ 声音复刻上传 `POST /uploads/audio/voice`。
- ⚙ → 声音：选录音文件 + 填逐字文本 → 一键克隆，音色 uri 自动填入，可试听；`VITE_VOICE_*` 可打进安装包。
- **嘴型等声音**：云端合成有 1–2 秒网络延迟，嘴型改为音频真正开始播放（`playing`）时才启动，播完即收嘴；聊天回复与主动说话共用 `speakWithBody`。
- 合成失败（断网 / 余额不足 / Key 错）自动退回系统语音，并保留可读原因；新句子会打断旧句子，不会两段声音叠在一起。
- ⚙ 里的 TTS 开关、音量、语速对克隆声音同样生效（`BrowserTtsController.getVoiceParams()`）。

### 底线（代码内置，人设改不掉）
- 模板由「你就是他本人」改为「他做的数字分身」：平时照常用他的口吻，她认真问是不是本人时如实回答。
- 提到身体不适、危险或伤害自己的念头时，引导她联系本人或身边的人，紧急时 120 / 110。

### 主动陪伴（修正触发逻辑）
- 此前由孤独值触发，而孤独值只在**人不在电脑前**时上涨 → 会对着空屋子说话、她在用电脑时反而从不开口；
  且 VOID 输入框聊天不会通知内核，聊着天也可能每 30 秒插话。
- 现在：她在电脑前（5 分钟内有鼠标 / 键盘活动）+ 5 分钟没聊天 + 距上次主动开口超过设定间隔（默认 45 分钟）+ 不在安静时段（默认 0–8 点）。
- `RuntimeKernel.proactive` 新增 `cooldownMs` / `isAllowed` / `getLastUserActivityAt`（向后兼容）。
- 主动说的话显示在对话框里（不再是头顶小气泡）+ 朗读 + 嘴型 + 写入聊天记忆。

### 送人 / 打包
- `.env.local` 预置 Key / 名字 / 称呼 / 主动陪伴参数，打进安装包，对方装上即用；
  `VITE_COMPANION_LOCK_SETTINGS=true` 隐藏 Key 与人设设置，且只认打包配置。
- **开机自启**：首次运行（发布版）自动开启，托盘菜单「开机自动启动」可关；开发模式不写启动项。
- `VRMUtils.rotateVRM0`：VRoid 导出 VRM 0.x 也自动转正，替换自己的形象不会背对屏幕。

### 打包修复（真机反馈）
- **Tauri 版本不一致导致 `tauri build` 拒绝打包**：`@tauri-apps/api` 2.11 ↔ `tauri` 2.12、`@tauri-apps/plugin-http` 2.8 ↔ `tauri-plugin-http` 2.5。
  以 Cargo.lock 为准两边锁到同一 minor（npm 用 `~`，Cargo.toml 用 `~2.x`）；新增 `pnpm avatar:check-tauri-versions` 并纳入 v040 闸门。
  此前只做了 `cargo check`，没跑 Tauri CLI 的版本校验——现在用 `tauri build --no-bundle` 全量 release 编译验证通过。
- 声音样本拦截 m4a（硅基流动只接受 mp3 / wav / pcm / opus）。

### 验证
- 新增 41 个单测（云端 Provider、设置存储 / 锁定 / 清洗、安静时段、人设提示词与底线、CompanionBrain 实时切换、主动陪伴 Provider、内核冷却与闸门、在场判定、云端语音 / 声音复刻 / 嘴型时序 / 失败回退 / 打断）。
- 浏览器端到端（模拟硅基流动）：上传录音 → 拿到 `speech:` 音色 → 试听 → 聊天回复走克隆声音，嘴型在出声后启动、声音结束收嘴，无系统语音回退。
- 浏览器端到端（模拟 OpenAI 兼容服务）：⚙ 填错误 Key → 「API Key 无效或无权限（HTTP 401）」；正确 Key → ✅；改人设后请求里带上人设 / 称呼 / 当前时间；刷新后配置保留。
- `pnpm avatar:v040-companion-gate` / `v039-completion-gate` / `day15a-demo-gate` 全绿；`cargo check`（dev + release）通过。

---

## v0.3.9 — Completion Patch（可交付态）· 2026-10-03

**状态切换：Demo 冻结版 → 打开即用、打包后也能用的可交付版**

此前信号层全绿（tsc / 433 单测 / vite build），但真机存在若干"测试测不到"的断点。本版本逐一补齐。

### 阻断级修复
- **默认白屏**：`Avatar.tsx` 默认皮肤 `frieza-3d` 加载不入库的 `/models/frieza.glb`（`*.glb` 被 .gitignore 忽略），
  GLTF 解析失败冒泡卸载整棵 React 树。改为默认走 AvatarService → VOID VRM；遗留皮肤只在 `setSkin()` 时启用；
  新增 `SkinErrorBoundary`，资源缺失只隔离身体并自动退回默认身体。
- **大脑永远连不上 Ollama**：`agent/ollama-provider.ts` 把原生 `fetch` 存成字段后以 `this.fetchImpl()` 调用，
  浏览器 / WebView2 抛 `Illegal invocation`，JsonLlmBrain 每次都静默退回规则脑。已绑定并加回归测试。
- **打包后 CORS**：Tauri 打包后页面来源 `http://tauri.localhost` 不在 Ollama 默认 `OLLAMA_ORIGINS` 内。
  新增 `tauri-plugin-http` + `platform/local-fetch.ts`，对话脑与 RuntimeKernel 均经 Rust 侧访问 Ollama；
  capability 仅放行 `127.0.0.1:11434` / `localhost:11434`。
- **无法退出**：窗口无边框 + `skipTaskbar`，此前只能用任务管理器结束。新增系统托盘：左键显示/隐藏，菜单「总在最前 / 退出」；
  退出走窗口 close 请求，先 flush 关系持久化。

### 功能补齐
- **多轮对话记忆**：`ConversationMemory`（localStorage 持久化，默认带最近 12 条上下文），VOID 记得前面聊过什么，重启不丢；⚙ 面板可清空。
- **思考态**：等待大脑时显示跳动的点 + thinking 表情（`AgentBodyBridge.setThinking`）。
- **Brain 灯如实**：绿=LLM 在线，橙=规则回退（悬停显示原因），灰=探测中；生产包隐藏无意义的 Vite 灯。
- **生命状态接入 VOID**：`mood` 此前传入 VoidVrmSkin 但未使用；现在空闲时 AvatarFSM 情绪驱动 VRM 表情预设。
- **主动说话有声音**：RuntimeKernel 孤独感自发说话此前只有气泡；现在补上朗读 + 嘴型并写入对话记忆。
- **身体选择持久化**（v0.3.4 Phase C）：`createLocalAvatarStorage()` 取代内存占位；未知 id 不恢复。
- **界面收纳**：TTS / LipSync 控件收进 ⚙ 抽屉，不再压在 360×460 小窗的角色身上；回话气泡按长度自动淡出；DEV 调试按钮不再挡住「发送」。
- **浏览器预览不报错**：`isTauri()` 守卫 `listen` / `invoke` / plugin-fs / close handler，非 Tauri 环境静默降级。
- 主动说话与对话默认同一模型（`qwen2.5:7b`，均读 `VITE_OLLAMA_MODEL` / `VITE_OLLAMA_ENDPOINT`）。

### 验证
- 新增 20 个单测（对话记忆、多轮历史、Brain 状态、思考态、头像持久化、fetch 绑定回归）。
- `pnpm avatar:v039-completion-gate` 全绿；`cargo check` 通过（含 tray-icon / plugin-http）。
- 浏览器端到端：两轮对话 → 刷新 → 第三轮仍带上前 4 条历史；Brain 灯随 Ollama 在线变绿。

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
