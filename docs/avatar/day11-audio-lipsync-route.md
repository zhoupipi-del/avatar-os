# Day11A — Audio TTS Pipeline Probe · 音频 LipSync 路线报告

> 生成于 Day11A（2026-07-27）。配套接口代码：`apps/desktop/src/avatar/agent/audio-tts-provider.ts`
> 参考依据：`avataros-reference-analysis.md`、`reference/extract/airi_lip-sync.ts`、`reference/extract/sap_vrm-formant-lipsync.js`

## 0. 结论先行

真实音频 LipSync 的前提：**AvatarOS 必须先能拿到 TTS 的"可分析音频"**（AudioNode / AudioBuffer / PCM）。
当前产品语音 `BrowserTtsController` 走 Web Speech `speechSynthesis`，**不暴露任何 AudioNode**，因此无法直接做 FFT / 共振峰 / wLipSync 分析。

Day11A **不替换** BrowserTtsController，也**不接**真实音频，只做两件事：

1. 定义可插拔的 `AudioTtsProvider` 接口与 `AudioTtsCapability` 能力描述（probe）。
2. 用占位实现 `UnsupportedAudioTtsProvider` + `describeBrowserTtsCapability()` 证明：
   - 接口可落地；
   - 当前 BrowserTTS 的 capability 是全 false —— 即"以后要接真实音频，必须先有 `supportsAudioNode` / `supportsAudioBuffer` 的 TTS 提供方"。

## 1. BrowserTTS 当前限制

| 项 | 现状 |
|----|------|
| 引擎 | `window.speechSynthesis` + `SpeechSynthesisUtterance` |
| 暴露 AudioNode | ❌ 无 |
| 暴露 AudioBuffer | ❌ 无 |
| 暴露 PCM | ❌ 无 |
| 可控项 | 语速 / 音高 / 音量 / 开关 / 选嗓 |
| 适合 | 稳定产品语音（文本 → 朗读） |

→ 它满足"说话"，但**不满足**"分析声音驱动嘴型"。

## 2. SAP 共振峰（Formant F1/F2）路线需要什么

来源：super-agent-party `static/js/vrm.js`（**AGPL-3.0，仅学思路、不复制源码**；算法骨架见 `reference/extract/sap_vrm-formant-lipsync.js` 与 `avataros-reference-analysis.md` §3）。

必要条件：

1. 一个 **AudioContext**（`new AudioContext()`）。
2. 音频源为 `Audio`（`new Audio(audioDataUrl)`）→ `createMediaElementSource(audio)` 得到 **AudioNode**。
   （或等价地用 `AudioBufferSourceNode`。）
3. AudioNode → `AnalyserNode`（`createAnalyser()`，`fftSize = 1024`）。
4. 每帧 `analyser.getByteFrequencyData(dataArray)` → 200–1000Hz 找 F1（开口大小）、1000–3000Hz 找 F2（舌位）→ 元音三角映射 `aa/ih/ou/ee/oh` → `setValue`。
5. 停止时全部 `setValue(v, 0)`。

→ 对应 `AudioTtsCapability.supportsAudioNode = true`。

优点：零 ML、纯 Web Audio、轻量、中文"啊/一/呜/耶/哦"映射合理。
缺点：依赖真实音频流；SAP 代码不能复制（AGPL），只能**干净重写思路**（即 Day11B）。

## 3. airi wLipSync 路线需要什么

来源：airi `packages/stage-ui-three/src/composables/vrm/lip-sync.ts`（**MIT，可借鉴**；切片见 `reference/extract/airi_lip-sync.ts`）。

必要条件：

1. TTS 产出 **AudioBuffer / WAV / ArrayBuffer**（kokoro / piper / edge-tts 等文件/流 TTS 天然具备）。
2. `AudioBufferSourceNode`（`audioContext.createBufferSource()`）→ 接 wLipSync 节点。
3. wLipSync 输出 AEIOUS 权重 → 投影到 AEIOU（S 并入 I）→ `BLENDSHAPE_MAP { A:aa, E:ee, I:ih, O:oh, U:ou }`。
4. winner + runner 混合 + 指数平滑 `1 - exp(-rate * dt)`（ATTACK=50 / RELEASE=30 / CAP=0.7）→ `setValue`。

→ 对应 `AudioTtsCapability.supportsAudioBuffer = true`。

优点：ML 模型对噪声/语种更鲁棒，口型更专业自然。
缺点：引入 `wlipsync` npm 依赖 + `lip-sync-profile.json`（MFCC 校准），复杂度更高。

## 4. 后续推荐路线（待 BOSS 拍板）

| 阶段 | 内容 | 前置 |
|------|------|------|
| **Day11A（本步）** | AudioTtsProvider 接口 + capability 探针 | — 已完成 |
| **Day11B** | SAP-style Formant Engine 干净重写（不动 SAP 源码，仅重写思路）：AudioContext + AnalyserNode + F1/F2 → aa/ih/ou/ee/oh | 需一个 `supportsAudioNode` 的 TTS 提供方（如 edge-tts/kokoro/piper 产 WAV → MediaElementSource） |
| **Day11C** | 接 airi-style wLipSync：AudioBufferSourceNode + wlipsync → AEIOUS | 需引入 wlipsync 依赖 + 一个 `supportsAudioBuffer` 的 TTS 提供方 |

建议顺序（BOSS 已拍板）：**Day11A（接口）→ Day11B（SAP 重写）→ Day11C（airi 评估）**。

关键决策点：无论走 11B 还是 11C，**都必须先把 TTS 换成可产出"可分析音频"的引擎**（即实现一个 `implements AudioTtsProvider` 且 capability 非全 false 的提供方）。这一步正是 Day11A 接口存在的意义。

## 5. 红线（本阶段已遵守 / 后续仍需遵守）

- ❌ 不复制 SAP AGPL 源码（只学思路重写）。
- ❌ 不引入 edge-tts / kokoro / piper / wlipsync（Day11A 阶段）。
- ❌ 不写 AudioContext 实现（Day11A 阶段）。
- ❌ 不驱动 expression（Day11A 阶段；口型仍由 Day9 文本 viseme 驱动）。
- ❌ 不修改 / 不替换 BrowserTtsController。

## 6. Day11B — Formant Viseme Analyzer（纯算法 clean-room 重写）

> 新增：`apps/desktop/src/avatar/agent/formant-viseme-analyzer.ts`
> gate：`scripts/avatar/formant-viseme-analyzer-gate.mjs`

Day11B **不接 runtime、不创建音频对象、不写表情**，只把"频域数据 → 元音口型权重"的算法核心做出来，为 Day12 真实音频集成铺路。

### 接口
- `analyzeFormantViseme(input: { frequencyData, sampleRate, noiseGate? }): FormantVisemeResult`
- `findPeakInRange(frequencyData, sampleRate, minFreq, maxFreq): FormantPeak`
- `computeVocalEnergy(frequencyData, sampleRate, minFreq, maxFreq): number`
- 类型：`MouthShape = "aa"|"ih"|"ou"|"ee"|"oh"`、`FormantPeak`、`FormantVisemeResult`

### 分类规则（优先级）
1. 静音 / 低能量（vocalEnergy ≤ noiseGate，默认 15）→ inactive，全 0
2. F1 高（>500Hz）→ aa（大张嘴）
3. F1 低（<350Hz）+ F2 高（>1500Hz）→ ih + ee×0.3
4. F1 低 + F2 低 → ou
5. F2 高（F1 居中）→ ee + ih×0.2
6. 兜底 → oh + ou×0.3

### 频率区间（源自 SAP 概念，仅参考不复制）
- F1 搜索：200–1000Hz（开口大小）
- F2 搜索：1000–3000Hz（舌位前后）
- vocalEnergy：200–4000Hz 平均

### 红线（本步已遵守）
- ❌ 不创建 AudioContext / AnalyserNode / MediaElementSource / AudioBufferSourceNode
- ❌ 不引入 wlipsync / edge-tts / kokoro / piper
- ❌ 不写 `.setValue(`（仅 lip-sync-expression-writer.ts 允许）
- ❌ 不复制 SAP AGPL 源码（仅重写思路）
- ❌ 不接 VoidVrmSkin / BrowserTtsController / LipSyncControlOverlay

## 7. 后续路线（BOSS 已拍板修订）

> 修订说明：原 Day11C"选 edge-tts / kokoro / piper 之一"的方向被 BOSS 压住 ——
> **Day11C 不接任何真实 TTS**，只做频谱源适配层（纯数据）。真实 TTS 提供方选择推迟到 Day13。

| 阶段 | 内容 | 前置 |
|------|------|------|
| **Day11A** | AudioTtsProvider 接口 + capability 探针 | 已完成（v0.3.16） |
| **Day11B** | 纯算法 Formant Viseme Analyzer（F1/F2 → aa/ih/ou/ee/oh） | 已完成（v0.3.17） |
| **Day11C（本步）** | Audio Source Adapter Probe：AudioSpectrumSource + FormantVisemeRuntimeProbe（纯数据，不接真实 TTS） | 无需 runtime，已落地 |
| **Day12** | WebAudio Runtime Bridge：真实频谱源实现 AudioSpectrumSource（可先用 mock/local fixture） | Day11C 适配层 |
| **Day13** | 真实 TTS provider 选择：13A edge-tts / 13B kokoro / 13C piper（三选一，届时拍板） | Day12 bridge |

建议顺序（BOSS 拍板）：**Day11A（接口）→ Day11B（算法）→ Day11C（适配层）→ Day12（bridge）→ Day13（真实 TTS 实装）**。

## 8. Day11C — Audio Source Adapter Probe（频谱源适配层，纯数据）

> 新增：`apps/desktop/src/avatar/agent/audio-spectrum-source.ts`、`formant-viseme-runtime-probe.ts`
> gate：`scripts/avatar/audio-source-adapter-probe-gate.mjs`

Day11C 把 Day11A（AudioTtsProvider capability）与 Day11B（analyzer 算法）中间那层补上：

```
frequencyData source → AudioSpectrumSource → FormantVisemeRuntimeProbe → analyzeFormantViseme()
```

**不接真实 TTS、不接 runtime、不让嘴动** —— 数据全部来自静态 fixture。

### audio-spectrum-source.ts
- `AudioSpectrumSource`：`sampleRate` + `getFrequencyData(): Uint8Array` 的频谱源抽象（Day12 的真实实现将实现它）
- `StaticFrequencySpectrumSource`：单帧静态源（每次返回防御性副本，非 Uint8Array 输入 clamp+round 归一化）
- `CyclingFrequencySpectrumSource`：多帧循环源（`getCursor()` / `resetCursor()`，空帧数组安全兜底）
- `createSilentSpectrumSource(binCount?, sampleRate?)`：全 0 静音源工厂 → analyzer 必然 inactive

### formant-viseme-runtime-probe.ts
- `FormantVisemeRuntimeProbe(source, { noiseGate? })`：无内部定时器，调用方决定节奏
  - `update()`：拉一帧 → `analyzeFormantViseme` → 缓存并返回；无 source / source 抛错 → 返回 null 不 throw 不计数
  - `getStatus()`：`{ active, lastResult, updateCount, lastReason }`（无结果时 lastReason="no-update"）
  - `setSource(source | null)`：运行时换源；`reset()`：清状态留源；`cancel()`：断源 + 清状态
- `FormantVisemeProbeStatus` / `FormantVisemeProbeOptions` 类型

### 红线（本步已遵守）
- ❌ 不接 edge-tts / kokoro / piper / wlipsync
- ❌ 不创建 AudioContext / AnalyserNode / MediaElementSource / AudioBufferSourceNode
- ❌ 不改 VoidVrmSkin / BrowserTtsController / LipSyncControlOverlay（gate 校验三者不 import 新模块）
- ❌ 不写 `.setValue(`、不驱动 expression（口型仍由 Day9 文本 viseme 驱动）
- ❌ 新模块不反向 import runtime / writer（gate 校验）

## 9. Day12 — WebAudio Runtime Bridge（真实频谱源实现 AudioSpectrumSource）

> 新增：`apps/desktop/src/avatar/agent/web-audio-spectrum-source.ts`、`web-audio-formant-probe.ts`
> gate：`scripts/avatar/web-audio-runtime-bridge-gate.mjs`

Day12 把 Day11C 的适配层接到"浏览器真实音频分析能力"上，但**仍然不进产品 runtime、不接 BrowserTtsController / VoidVrmSkin / LipSyncControlOverlay / TextVisemeExpressionDriver / LipSyncExpressionWriter**——只在 isolated module + 测试验证链路，证明"真实频谱 → 口型"可行。

### 设计：依赖注入（不创建音频对象）
- `WebAudioSpectrumSource` 实现 Day11C 的 `AudioSpectrumSource`（`sampleRate` + `getFrequencyData(): Uint8Array`）。
- 构造函数接收 `pullFrequencyData(data: Uint8Array): void` 注入函数（由调用方用真实 `AnalyserNode.getByteFrequencyData` 包装后传入）与可选 `dispose()` 钩子。
- **本模块绝不 `new AudioContext` / `new AnalyserNode` / `createMediaElementSource` / `new Audio()` / `new AudioBufferSourceNode`**——测试用 fake analyser 注入，无需任何真实音频对象。
- `getFrequencyData()` 复用内部 buffer 并放回防御性副本；`pullFrequencyData` 抛错时吞掉返回全 0，不向上抛异常。

### web-audio-formant-probe.ts
- `WebAudioFormantProbe(source, { noiseGate? })`：内部复用 Day11C 的 `FormantVisemeRuntimeProbe`，封装成面向 WebAudio 频谱源的便利封装。
  - `update()`：拉一帧 → `analyzeFormantViseme` → 返回 `FormantVisemeResult | null`
  - `getStatus()`：`{ active, lastResult, updateCount, lastReason, sourceSampleRate }`
  - `dispose()`：安全释放频谱源（可重复调用）
- `createWebAudioFormantProbe(source)`：工厂，直接组装一条完整 bridge。

### 链路
```
WebAudioSpectrumSource(pullFrequencyData 注入) → getFrequencyData() → FormantVisemeRuntimeProbe.update() → analyzeFormantViseme() → FormantVisemeResult
```

### 红线（本步已遵守）
- ❌ 不接 edge-tts / kokoro / piper / wlipsync
- ❌ 不创建 AudioContext / AnalyserNode / MediaElementSource / AudioBufferSourceNode / `new Audio()`
- ❌ 不改 VoidVrmSkin / BrowserTtsController / LipSyncControlOverlay（gate 校验三者不 import 新模块）
- ❌ 不写 `.setValue(`、不驱动 expression（口型仍由 Day9 文本 viseme 驱动，本阶段不接）
- ❌ 新模块不反向 import runtime / writer / driver（gate 校验）
- ❌ 生产代码不得出现 `getByteFrequencyData`（只允许测试 fake 注入；真实接线推迟到 Day13）

## 10. Day13 路线（真实 TTS provider 选择，待 BOSS 拍板）

| 阶段 | 内容 | 前置 |
|------|------|------|
| **Day13A** | AudioFileTtsProvider：本地 WAV / base64 DataURL fixture 提供方，证明"文件型可分析音频"链路 | Day12 bridge |
| **Day13B** | edge-tts 评估（产 WAV → MediaElementSource → AnalyserNode） | Day13A 链路 |
| **Day13C** | kokoro 评估（产 WAV/PCM → AudioBufferSourceNode） | Day13A 链路 |
| **Day13D** | piper 评估（产 WAV/PCM → AudioBufferSourceNode） | Day13A 链路 |

建议顺序（BOSS 拍板）：**先用 AudioFileTtsProvider（本地 fixture）证明链路，再接真实 TTS 之一**。
