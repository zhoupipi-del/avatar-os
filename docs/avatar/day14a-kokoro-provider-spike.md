# Day14A — Kokoro Provider Minimal Spike

> 状态：已完成（待 BOSS 验收 PASS 后收口 push + tag `v0.3.24-kokoro-provider-spike`）
> 阶段性质：**Kokoro provider 最小实现探针**，不是产品接线、不是替换 BrowserTTS、不是让 VOID 真实口型动起来。

## 1. 当前 AvatarOS 已有链路

```
AudioTtsProvider 接口（Day11A）
  ← Local PCM Fixture Provider（Day13C，合成元音 PCM）
  ← Audio Fixture Provider（Day13A，循环频谱帧）
        ↓
PcmSpectrumSource（Day13C，PCM → Hann 窗 → radix-2 FFT → 0~255）
        ↓
FormantVisemeRuntimeProbe（Day11C，update → F1/F2 → aa/ih/ou/ee/oh）
        ↓
LocalPcmFormantPipeline（Day13C，speakAndAnalyze 聚合）
```

Day14A 要证明的是：**把"真实 kokoro 合成"塞进这条链路的 `AudioTtsProvider → PCM` 这一段**，
让 kokoro 的输出也能流经 `PcmSpectrumSource → FormantVisemeRuntimeProbe → viseme 分类`。

## 2. Day14A 只评估/探测 kokoro，不安装、不接 runtime

- 不写 `BrowserTtsController`、不改 `VoidVrmSkin`、不改 `LipSyncControlOverlay`。
- 不写 `expressionManager.setValue`、不驱动 VOID 嘴型。
- 不接 edge、不接 piper。
- 不 `new AudioContext`、不创建任何音频节点。

## 3. kokoro 关注点（依赖选择步骤实测）

通过 `pnpm view` 探查（已确认存在）：

| 字段 | 值 |
|------|-----|
| 候选包 | `kokoro-js` |
| 最新版本 | `1.2.1` |
| 许可证 | **Apache-2.0**（注：Day13D docs 中写的 "MIT" 是过时信息，以 npm metadata 为准） |
| 运行形态 | 纯 JS + onnxruntime-web（WASM/WebGPU），浏览器优先 |
| 输出形态 | `audio.audio: Float32Array`（PCM）+ `audio.sampling_rate` |

> ⚠️ **许可证修正**：Day13D 决策文档把 kokoro 记为 MIT，但 npm 上 `kokoro-js@1.2.1` 实际为 **Apache-2.0**。
> 两者均为 permissive 许可证，对 AvatarOS 商用无传染风险，但记录需准确。

选择原因：
- 浏览器 / Tauri WebView 优先设计，无需 C++/ONNX 原生绑定。
- 社区活跃、有离线运行案例、有中文音色（如 `af_heart` 等）。
- 输出为 `Float32Array` PCM，可直接喂入 Day13C 的 `PcmSpectrumSource`。

## 4. 实现策略：动态 import 探测 + graceful fallback（不硬接）

Day14A **未将 `kokoro-js` 写入 `dependencies`**，理由与纪律：

1. **避免 lockfile 污染 / 四道基础闸门回归**：
   `kokoro-js` 依赖 `onnxruntime-web`（wasm 二进制 + 数十依赖），一旦 `pnpm add` 会改写 `pnpm-lock.yaml`，
   并可能给 `vite build` / `tsc` 带来不可控影响，破坏必须稳定的四道基础闸门。
2. **避免模型联网下载硬失败（Day14A 红线）**：
   真实 `synthesize` 需要下载 `Kokoro-82M` 模型权重（约数百 MB ~ 1GB），在 CI / 本机必然超时或失败。
   Day14A 明确要求"不允许硬失败在模型下载上"。
3. **符合 BOSS 降级条款**：
   "如果没有稳定可用包，Day14A 降级为 Kokoro Provider Stub + 安装失败报告，不硬接。"

因此 `KokoroProviderSpike` 采用：

- 用**字符串变量 specifier** 动态 `import(KOKORO_SPECIFIER as string)`（带 `/* @vite-ignore */`），
  tsc 不解析模块、vite 不静态打包，未安装时 `import` 抛错被 `try/catch` 吞掉返回 `null`。
- 包可用时走完整真实合成链路（`KokoroTTS.from_pretrained` → `generate` → `audio.audio` → `PcmSpectrumSource`）。
- 包不存在（本机默认）时 `isAvailable()=false`，`speak()` 返回不可用 session，不抛错。

## 5. piper 关注点（本轮不进入）

- piper 本质是 C++ / ONNX，浏览器 / Tauri WebView 兼容性依赖 wasm 端口，成熟度待验证。
- 打包复杂度高于 kokoro（模型 + wasm + 音素化器）。
- Day14A 仅聚焦 kokoro；若 kokoro 后续失败，Day14B 再评估 piper（见路线）。

## 6. 推荐 Day14 只选一个 provider 做最小实现

当前证据（Day13D 决策 + 本节实测）一致指向 **kokoro 优先**：

- 许可证 Apache-2.0（permissive）。
- 浏览器优先、输出为可直接分析 PCM。
- 真实合成路径已在 `KokoroProviderSpike.load()` 完整实现，仅受"模型是否本机可下载"这一外部因素限制。

**下一步（待 BOSS 拍板）**：
- Day14B：Kokoro Provider Hardening（若要在本机端到端实跑，执行 `pnpm --filter desktop add kokoro-js` 并在有网络环境下载模型后运行 spike；同时加固错误处理、音色选择、采样率适配）。
- Day14C：Kokoro → PCM → Formant pipeline 稳定化。
- Day15：再讨论是否接产品 runtime（让 VOID 真实口型动起来）。

## 7. 验收清单（Day14A）

- [x] kokoro provider spike 测试全过（6 项）
- [x] kokoro formant pipeline spike 测试全过（6 项）
- [x] gate 全过（含四道基础闸门）
- [x] 真实依赖若不可用，graceful fallback（不抛错、不硬失败）
- [x] 未改 BrowserTtsController / VoidVrmSkin / LipSyncControlOverlay
- [x] 未创建 AudioContext
- [x] 未写 expression
- [x] 未接产品 runtime

## 8. 新增 / 修改文件

新增：
- `apps/desktop/src/avatar/agent/kokoro-provider-spike.ts`
- `apps/desktop/src/avatar/agent/kokoro-provider-spike.test.ts`
- `apps/desktop/src/avatar/agent/kokoro-formant-pipeline-spike.ts`
- `apps/desktop/src/avatar/agent/kokoro-formant-pipeline-spike.test.ts`
- `scripts/avatar/kokoro-provider-spike-gate.mjs`
- `docs/avatar/day14a-kokoro-provider-spike.md`

修改：
- `apps/desktop/src/avatar/agent/index.ts`（导出 2 个新模块）
- `package.json`（加 `avatar:kokoro-provider-spike-gate` 脚本）
- `docs/avatar/day11-audio-lipsync-route.md`（路线表 + 下一步）
