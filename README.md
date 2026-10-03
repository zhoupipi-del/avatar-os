# AvatarOS · VOID

桌面数字生命体：一个常驻桌面的 3D VRM 角色（VOID），能看着你的鼠标、眨眼、呼吸，
用本地大模型（Ollama）和你聊天，边说边做表情、动嘴型、做动作；没人理它时会无聊、孤独、犯困，甚至主动找你说话。

技术栈：React 18 + React Three Fiber 8 + `@pixiv/three-vrm` 3.5.3 + Tauri 2（Rust）· pnpm monorepo。

> 💝 **陪伴模式**：用云端大模型（不用装 Ollama）+ 你自己的 VRoid 形象 + 你的人设 + 你的克隆声音，打包送给她，开机就陪在她桌面上。
> 一步步做法见 **[docs/companion-guide.md](docs/companion-guide.md)**。

---

## 快速开始（Windows）

前置：Node 20+、pnpm 9+、Rust（MSVC 工具链）、WebView2（Win10/11 自带）、[Ollama](https://ollama.com)。

```bash
pnpm install
ollama pull qwen2.5:7b          # 机器吃紧可用 qwen2.5:0.5b，并设置 VITE_OLLAMA_MODEL
pnpm --filter desktop tauri dev # 或双击 start-demo.bat
```

首次编译 Rust 需要几分钟。窗口出现后：

- 底部输入框打字回车 → VOID 思考（三个跳动的点）→ 回话 + 朗读 + 嘴型 + 动作
- 左上角 ⚙ → 语音 / 嘴型设置、对话记忆条数、清空记忆
- 顶部状态条：`VRM / Brain / TTS / Lip`（DEV 下多一个 `Vite`）
  - Brain **绿**=Ollama 在线；**橙**=Ollama 不可达，已退回本地规则脑（鼠标悬停看原因）；**灰**=探测中
- 系统托盘图标：左键显示/隐藏，右键菜单「总在最前 / 退出」（窗口无边框且不进任务栏，托盘是退出入口）

不想装 Ollama：设置 `VITE_AVATAROS_BRAIN_MODE=rule`，VOID 用内置规则脑回话。

纯浏览器预览（不编译 Rust）：`pnpm dev` 后打开 http://localhost:1420 。
Tauri 专属能力（全局鼠标、点击穿透、SQLite、关系持久化）在浏览器下会自动降级，不报错。

### 打包

```bash
pnpm --filter desktop tauri build   # 产物：src-tauri/target/release/bundle/msi/*.msi
```

打包后的页面来源是 `http://tauri.localhost`，**不在 Ollama 默认 CORS 白名单里**；
本项目经 `tauri-plugin-http` 从 Rust 侧访问 Ollama 来绕开（capability 只放行 `127.0.0.1:11434` / `localhost:11434`）。
若你把 `VITE_OLLAMA_ENDPOINT` 改成别的地址，需要同步改 `src-tauri/capabilities/default.json` 的 `http:default` 范围。

---

## 配置

运行时在 ⚙ 设置里改（大脑来源、API Key、人设、声音、主动陪伴），保存在本机。
构建期默认值放 `apps/desktop/.env.local`（参考 `.env.example`，陪伴相关变量见其中注释）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `VITE_AVATAROS_BRAIN_MODE` | 有 Key 时 `cloud`，否则 `ollama` | `cloud` / `ollama` / `rule` |
| `VITE_CLOUD_PRESET` / `VITE_CLOUD_API_KEY` | `deepseek` / 空 | 云端模型厂商与 Key |
| `VITE_COMPANION_NAME` / `VITE_COMPANION_NICKNAME` | `VOID` / 空 | 角色名、怎么称呼她 |
| `VITE_VOICE_API_KEY` / `VITE_VOICE_ID` | 空 | 克隆声音（硅基流动 Key + `speech:...` 音色）；都填了就用你的声音朗读 |
| `VITE_COMPANION_LOCK_SETTINGS` | `false` | 送人用：隐藏 Key、人设与声音设置 |
| `VITE_OLLAMA_ENDPOINT` | `http://127.0.0.1:11434` | 用 127.0.0.1 而非 localhost（Windows 上 localhost 可能先解析 IPv6） |
| `VITE_OLLAMA_MODEL` | `qwen2.5:7b` | 对话与主动说话共用 |
| `VITE_OLLAMA_TIMEOUT_MS` | `60000` | 单次请求超时 |

---

## 架构

```
用户输入 ─▶ AgentRuntime ─▶ JsonLlmBrain(Ollama, 多轮记忆) ──失败──▶ RuleBasedBrain
                │                      │
                ▼                      ▼
          VOID BodyBridge     ConversationMemory(localStorage)
     ┌──────────┼───────────┬──────────────┐
  TTS 朗读   表情预设   VRMA 动作      文本 viseme 嘴型

LifeLoop(1s 心跳) ─▶ DriveEngine / AvatarFSM(Mood) ─▶ 空闲时驱动 VOID 表情
RuntimeKernel ─▶ 孤独感超阈值 ─▶ CognitionEngine 主动说话 ─▶ 气泡 + 朗读 + 嘴型
```

| 目录 | 内容 |
|---|---|
| `apps/desktop/src/avatar/skins/VoidVrmSkin.tsx` | VOID 主身体：VRM 加载、每帧管线（动画→视线→表情→眨眼→嘴型→SpringBone）、智能体接线 |
| `apps/desktop/src/avatar/agent/` | 对话大脑、记忆、TTS、嘴型（文本 viseme）、Kokoro 真实音频 spike |
| `apps/desktop/src/avatar/vrm/` | VRM/VRMA 加载、眨眼/视线/表情/稳定性控制器 |
| `apps/desktop/src-tauri/` | 透明置顶窗口、全局鼠标钩子（Windows）、点击穿透、托盘、SQL/FS/HTTP 插件 |
| `packages/runtime` | 内核：事件总线、LifeLoop、DriveEngine、BehaviorVM、关系引擎、AvatarService |
| `packages/cognition` | RuntimeKernel 用的认知引擎（主动思考）+ 意图归一化 |
| `packages/memory` | 生命周期记忆（Tauri 下 SQLite，浏览器下 localStorage） |
| `packages/morphology` / `sensor` / `primitives` / `telemetry` | 肢体运动学、在场感知、共享类型、遥测 |

调试：DEV 下右上角「调试」切换高级调试信息，`🐶 OS·DBG` 打开运行时事件追踪；
控制台 `window.__avatarOSAgent.receiveText("你好")` / `.clearMemory()`；
`window.__AVATAR_DEV__.setSkin('classic-2d')` 切遗留实验皮肤（frieza-3d / mecha-core 需要本地 `public/models/*.glb`，未入库）。

---

## 测试与闸门

```bash
pnpm vitest run                              # packages 单测
pnpm --filter desktop exec vitest run        # desktop 单测
pnpm avatar:v039-completion-gate             # 当前版本收口闸门（含 tsc / build / 两套测试）
pnpm avatar:day15a-demo-gate                 # Demo 闸门
```

> `scripts/avatar/` 下更早的 Day 闸门（如 `fast-demo-gate`、`day11-*`）是当时阶段的冻结契约，
> 会因为后续阶段合法引入的 TTS / LipSync / Kokoro 文件而报 FAIL，属预期，不代表回归。

## 已知限制

- 嘴型由文本节奏驱动（非音频分析）；Kokoro 真实音频链路仍是 spike（见 `docs/avatar/day14*`）。
- 朗读用系统 Web Speech 语音，音色取决于 Windows 已安装的中文语音包。
- 全局鼠标跟随仅 Windows 实现。
