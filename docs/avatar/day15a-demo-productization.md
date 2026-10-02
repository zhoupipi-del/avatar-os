# Day15A — Demo Productization Freeze

> 目标：**不追加底层能力**，把现有「能动 / 能说 / 能回 / 能嘴动」的桌面智能体原型，收口成**能稳定展示给别人看**的版本。
> 主线：Demo 落地。支线（Kokoro 真实音频）按下不表，留待 Demo 稳定后回头。

## 红线处理（已与 BOSS 拍板）

Day11–14 的「最高优先级红线」曾规定 **不改 `VoidVrmSkin` / `VoiceControlOverlay` / `LipSyncControlOverlay`**。
本次 Day15A 经 BOSS 明确放宽：**仅限 UI 可见性层**——隐藏 debug 块、加 demo 开关，**音频 / 表情 / 嘴型算法一行不动**。

## 改了什么

| 文件 | 改动 | 性质 |
|---|---|---|
| `src/demo/demo-runtime.ts` | 新增。演示模式 pub/sub 开关（默认干净，DEV 下 `?debug` 或齿轮按钮揭示内部状态） | 纯 UI 状态，不碰 runtime |
| `src/demo/DemoStatusBar.tsx` | 新增。启动自检状态条，聚合 5 个**真实**信号：VRM / Brain / TTS / Lip / Vite | 只读探针，不造假 |
| `src/demo/DemoModeToggle.tsx` | 新增。DEV only 齿轮按钮，切换高级调试可见性 | 仅可见性 |
| `src/avatar/skins/VoidVrmSkin.tsx` | 引入 `useAdvancedDebug`；用 `showDebug` 门控 3 个纯 debug 块（lip-sync / rhythm / text-viseme 状态）；挂载 `DemoStatusBar`；向两个 overlay 传 `showDebug` | 仅可见性 |
| `src/avatar/agent/VoiceControlOverlay.tsx` | 接收 `showDebug`，门控内部 `__debug` 块 | 仅可见性 |
| `src/avatar/agent/LipSyncControlOverlay.tsx` | 接收 `showDebug`，门控内部 `__debug` 块 | 仅可见性 |
| `src/App.tsx` | DEV 下挂载 `DemoModeToggle` | 仅可见性 |
| `src/avatar/Avatar.css` | 新增状态条 / 齿轮按钮样式 | 样式 |
| `start-demo.bat` | 新增。Windows 一键 `pnpm --filter desktop tauri dev` | 启动脚本 |
| `scripts/avatar/day15a-demo-gate.mjs` | 新增。四道基础闸门 + 红线校验 | gate |

## Demo 行为

- **默认（无参数 / 生产构建）**：干净演示视图 —— 头像 + 输入框 + 回话气泡 + TTS/LipSync 控件（无原始 debug 文本）+ 顶部 5 灯自检条。
- **DEV + `?debug` 或点齿轮按钮**：揭示 3 个原始状态块 + 两个控件内部的原始 debug 文本。
- 生产构建（`tauri build`）中 `import.meta.env.DEV === false`，高级调试永不出现，齿轮按钮也不渲染。

## Demo Checklist（给别人演示前逐条确认）

- [ ] `start-demo.bat` 能拉起 Tauri 窗口（首次编译 ~数分钟，需 MSVC 已装）
- [ ] 窗口出现 3D 头像，能眨眼 / 头部跟随
- [ ] 顶部状态条 5 灯最终全绿（VRM / Brain / TTS / Lip / Vite）
- [ ] 输入框打字回车 → 头像回话 + 语音朗读 + 嘴型随文本动
- [ ] TTS 开关 / LipSync 开关可切换
- [ ] 默认视图无「LipSync: ... / Rhythm: ... / Text Viseme: ...」原始 debug 文本
- [ ] DEV 下点齿轮按钮 → 上述原始 debug 出现；再点 → 隐藏
- [ ] 不出现 Vite 报错 / Tauri 白屏 / 控制台红色异常

## 验证

```bash
pnpm avatar:day15a-demo-gate
# 或分别跑四道基础闸门：
pnpm --filter desktop exec tsc --noEmit
pnpm --filter desktop exec vite build
pnpm --filter desktop exec vitest run
pnpm vitest run
```

## 收口状态

- commit：本地 `feat(avatar): demo productization freeze`（未 push、未 tag）
- `v0.3.26` 仍钉 `c9af45d`，未移动；Day14D 已提交 `b9659b3` 待验收收口
- 下一步（待拍板）：Day14E Kokoro Access Configuration Smoke（真实音频链路），或继续 Demo 打磨
