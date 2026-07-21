# Avatar OS — Day 2 Presence Engine 落地概览

> 以官方 Day 1 canonical monorepo 为基线（不是之前的 `@avatar/*` 平行树），在其上实现 Day 2「物理实体的生命律动」。

## 1. 架构重基线（Re-baseline）
- `avatar-os/` 已重置为官方 Day 1 交付物（`@avatar-os/*` 作用域，life-state / mood-engine / personality DNA / telemetry-level 解耦，SemanticIR 精简版，从 `src` 直跑无 dist 构建）。
- 旧树（含 FROZEN 大脑层）已整体备份至 **`avatar-os.bak-20260720/`**，零丢失。
- 补齐了 canonical zip 缺失的可运行基建：`vite.config.ts`(端口1420)、`tsconfig.json`、`tailwind.config.js`、`postcss.config.js`（Tailwind 必需——Avatar 的 `MOOD_GRADIENTS` 是 Tailwind 渐变类）。

## 2. Day 2 实现（`apps/desktop/src/presence/presence.ts`）
纯定时器 + 概率 + LifeState 驱动，**不依赖任何 AI**：
- **伸懒腰 (stretch)**：闲置 >90s 且 `AvatarState.IDLE`，35% 概率 emit `PRESENCE_ACTION{action:'stretch'}`（Avatar 已消费做拉伸动画）。
- **低频关怀 (ambient care)**：闲置 >240s 且 IDLE，40% 概率 emit `PRESENCE_AMBIENT_SPEECH{text}`；App 新增淡红 italic 气泡，6s 自动消失。
- **呼吸交互 (breathing)**：闲置时 `energy` 缓回、`attention` 缓降（注意力随交互升、随离开降）；每 tick 调 `moodEngine.calculateAndApply(undefined,{idleDurationMs,timeOfDay})` 演化 Mood（夜间→TIRED，注意力衰减后回落 CALM/CURIOUS）。
- 用户主动交互（click / input / mouseEnter / START_SPEAKING）重置闲置计时并回血（socialBattery / energy / attention 回升）。

## 3. 接线
- `App.tsx` 模块级 `presenceEngine.start()`；新增 `careText` 状态 + `PRESENCE_AMBIENT_SPEECH` 订阅。
- 早先 Day 1 已含：鼠标近场感应（`MOUSE_ENTER/LEAVE_AVATAR` + hover 放大）、`AVATAR_MOOD_CHANGED` 渐变配色、`PRESENCE_ACTION` 拉伸。

## 4. 验证
- `pnpm install`（走 Clash 7897 代理）✅；`pnpm rebuild esbuild` 修复 pnpm11 默认拦截的 postinstall ⚠️ 必要步骤。
- `pnpm dev` → Vite v5.4.21 ready，`http://localhost:1420` HTTP 200。
- 全模块图（App/presence/Avatar + runtime 四模块 + telemetry + personality）均 200，无转译错误；Tailwind 已处理（`from-indigo-500` 等工具类存在）。

## 5. 已知阻塞（影响后续路线图，非 Day 2 问题）
- Ollama 二进制缺失 → Day 15-20 LLM 接入卡住。
- Rust/cargo 缺失 → Tauri 原生 `.exe` 出不了包（web shell 预览不受影响）。

## 6. 怎么快速看到 Day 2 效果
- 打开预览后**别动它**：约 90s 后小圆球会偶尔「伸懒腰」（拉伸动画）；约 4min 后偶尔冒出一句关心气泡。
- 鼠标移上去会放大并广播近场事件；点击重置闲置计时（生命能量/注意力回升）。
- 想调快频率：改 `presence.ts` 里的 `IDLE_STRETCH_MS` / `IDLE_CARE_MS`。
