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

## 7. 后续路线（待 BOSS 拍板）

| 阶段 | 内容 | 前置 |
|------|------|------|
| **Day11A** | AudioTtsProvider 接口 + capability 探针 | 已完成（v0.3.16） |
| **Day11B（本步）** | 纯算法 Formant Viseme Analyzer（F1/F2 → aa/ih/ou/ee/oh） | 无需 runtime，已落地 |
| **Day11C** | Audio Source Adapter Probe：探测可产出 `supportsAudioNode` / `supportsAudioBuffer` 的 TTS 提供方 | 需选 edge-tts / kokoro / piper 之一 |
| **Day12** | Formant Runtime Integration：把 analyzer 接到真实音频流 + writer | 需 Day11C 提供方可分析音频 |
| **Day13** | Audio TTS Provider 实装选择（落地一个真实 TTS 提供方） | 同上 |

建议顺序（BOSS 拍板）：**Day11A（接口）→ Day11B（算法）→ Day11C（音频源探测）→ Day12（集成）→ Day13（实装）**。
