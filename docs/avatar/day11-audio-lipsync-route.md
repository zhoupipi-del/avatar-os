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

## 10. Day13→Day14 路线（真实 TTS provider 接入，待 BOSS 拍板）

| 阶段 | 内容 | 前置 |
|------|------|------|
| **Day13A（已完成）** | Audio Fixture Provider：用循环频谱帧（CyclingFrequencySpectrumSource）模拟"可分析音频播放"，串 Day11A provider + Day11C source + Day12 probe 成测试闭环。**不解码 WAV / 不接真实 TTS** | Day12 bridge |
| **Day13B（已完成）** | Real TTS Provider 评估：对 edge / kokoro / piper 三候选做许可证/运行时/打包/离线/浏览器/音频输出评估与排序，产出决策矩阵 + 最小 spike 建议。**不接产品 runtime、不引入真实 TTS 包** | Day13A 链路 |
| **Day13C（已完成）** | Local PCM Fixture Provider：用合成元音 PCM（f1/f2 共振峰模型）→ 纯 TS FFT → 频域幅度 → formant 分析，证明"类真实音频数据链路"。**不接真实 TTS、不接产品 runtime** | Day13A 链路 |
| **Day13D（已完成）** | TTS Dependency Spike：对 kokoro / piper 两候选做依赖可行性评估（包能否安装 / 浏览器运行 / 离线 / PCM 输出 / 中文音色 / 打包与运行时风险），产出决策矩阵 + Day14 推荐。**不安装真实包、不接产品 runtime、不驱动嘴** | Day13C 链路 |
| **Day14A（本步）** | Kokoro Provider Minimal Spike：用动态 import 探测 `kokoro-js`（1.2.1, Apache-2.0）做最小实现探针，真实合成路径完整实现但 graceful fallback（未实际安装包，避免 lockfile 污染与模型下载硬失败），证明 kokoro→PCM→Day13C formant 链路可接。**不接产品 runtime、不驱动 VOID 嘴型** | Day13C 链路 |

建议顺序（BOSS 拍板）：**先用 Day13A fixture provider（循环帧）证明链路，再用 Day13C PCM fixture 证明类真实音频数据链路，再用 Day13D 评估真实 TTS 依赖可行性，再用 Day14A 把 kokoro 接进 Day13C 频谱管线（最小探针），后续 Day14B/C 稳定化，Day15 再接产品 runtime**。

## 11. Day13A — Audio Fixture TTS Provider（测试闭环，不接真实 TTS）

> 新增：`apps/desktop/src/avatar/agent/audio-fixture-tts-provider.ts`、`audio-fixture-formant-pipeline.ts` 及对应 `.test.ts`
> gate：`scripts/avatar/audio-fixture-tts-provider-gate.mjs`
> 收口：commit `feat(avatar): add audio fixture TTS provider`（不 push 不 tag，待 BOSS 验收 PASS 后收口 push + tag v0.3.20）

Day13A 把 Day11A（provider 接口）/ Day11B（analyzer）/ Day11C（source + probe）/ Day12（bridge 设计）串成一条**端到端测试闭环**，但**不接任何真实 TTS、不接产品 runtime、不驱动嘴**：

```
AudioFixtureTtsProvider.speak(text)
  → AudioFixturePlaybackSession.getSpectrumSource()
  → CyclingFrequencySpectrumSource（元音帧循环，模拟可分析音频）
  → FormantVisemeRuntimeProbe.update() × N
  → aa / ih / ou / ee / oh（FormantVisemeResult[]）
```

### capability 扩展（向后兼容）
- `AudioTtsCapability` 新增可选字段 `supportsSpectrumSource?: boolean`；`NO_AUDIO_TTS_CAPABILITY` 显式置 `false`。
- 旧测试 `audio-tts-provider.test.ts` 用 `toEqual(NO_AUDIO_TTS_CAPABILITY)` 全等比较，扩展后仍为同一对象，不受影响（基础闸门 root vitest 已验证）。

### audio-fixture-tts-provider.ts
- `AudioFixtureTtsProvider implements AudioTtsProvider`：`getCapability()` 返回 `supportsAudioNode/AudioBuffer/Pcm=false, supportsSpectrumSource=true`；`isAvailable()=true`。
- `speak(text)`：用 `buildVowelFrames()` 构造 5 帧（aa/ih/ou/ee/oh）经 `CyclingFrequencySpectrumSource` 循环，返回 `AudioFixturePlaybackSession`（含 `text` / `durationMs` / `startedAt` / `status` / `getSpectrumSource()`）。
- `AudioFixturePlaybackSession implements AudioTtsPlaybackSession`：`getAudioNode/getAudioBuffer/getPcm` 全返回 null；`getSpectrumSource()` 暴露 fixture 频谱源；`cancel()` 幂等。
- **不 `new AudioContext` / 不 `new Audio()` / 不解码 WAV / 不写 expression**。

### audio-fixture-formant-pipeline.ts
- `AudioFixtureFormantPipeline(provider)`：`speakAndAnalyze(text, frameCount?)` → `provider.speak` → 取频谱源 → `FormantVisemeRuntimeProbe` 逐帧 `update` → 聚合 `AudioFixturePipelineResult { sessionText, results, activeCount, reasons }`。
- `reset()`（清探针状态）/ `cancel()`（断会话+探针，幂等）；任何一步抛错吞掉返回空结果，不向上传播。
- `createAudioFixtureFormantPipeline(provider)` 工厂。
- **不接 VRM / UI，不写 expression**。

### 红线（本步已遵守）
- ❌ 不接 edge-tts / kokoro / piper / wlipsync
- ❌ 不创建 AudioContext / MediaElementSource / AudioBufferSourceNode / `new Audio()`
- ❌ 不改 VoidVrmSkin / BrowserTtsController / LipSyncControlOverlay（gate 校验三者不 import 新模块）
- ❌ 不写 `.setValue(`、不驱动 expression
- ❌ 新模块不反向 import runtime / writer / driver（gate 校验）
- ❌ Day13A gate 的禁用词扫描**仅限本 milestone 新增的 4 个文件**，避免误伤 Day11/Day12 既有注释（各 gate 互不干扰）

### 下一步（待 BOSS 拍板）
- **Day13B（已完成）**：Real TTS Provider 评估决策模块（`real-tts-provider-decision.ts`）+ 决策文档（`day13-real-tts-provider-evaluation.md`）。当前推荐 `kokoro` 居首，`piper` 紧随，二者均为本地/MIT/离线；`edge` 因在线+高许可证风险排末位。
- **Day13C（已完成）**：Local PCM Fixture Provider —— 用合成元音 PCM（f1/f2 共振峰模型）→ 纯 TS radix-2 FFT → 频域幅度 → formant 分析，证明"类真实音频数据链路"（PCM → AudioTtsProvider → PcmSpectrumSource → FormantVisemeRuntimeProbe → aa/ih/ou/ee/oh）。不接真实 TTS、不接产品 runtime、不驱动嘴。
- **Day13D（已完成）**：TTS Dependency Spike —— 对 kokoro / piper 两候选做依赖可行性评估（`tts-dependency-spike.ts`），回答五个核心问题：包能否安装 / 模型如何加载 / 中文能否出声 / 输出能否拿到 PCM 或 buffer / 能否接 Day13C 频谱管线。当前推荐 kokoro 居首（浏览器优先、风险更低），piper 次之（原生 PCM 输出但浏览器兼容性待验证）。**不安装真实包、不接产品 runtime、不驱动嘴**。
- **Day14A（已完成）**：Kokoro Provider Minimal Spike —— `kokoro-provider-spike.ts`（动态 import 探测 `kokoro-js`，真实合成链路完整实现 + graceful fallback）+ `kokoro-formant-pipeline-spike.ts`（speakAndAnalyze 接 Day13C formant）。**未实际安装 kokoro-js**（避免 lockfile 污染 + 模型下载硬失败），provider 真实路径代码已就位；本机默认走 fallback 不抛错。不接产品 runtime、不驱动嘴。
- **Day14B（待拍板）**：Kokoro Provider Hardening —— 若要在本机端到端实跑，执行 `pnpm --filter desktop add kokoro-js` 并下载模型权重，加固音色选择/采样率适配/错误分类。
- **Day14C（待拍板）**：Kokoro → PCM → Formant pipeline 稳定化。
- **Day15（待拍板）**：再考虑接产品 runtime（让 VOID 真实嘴型动起来）。

## 12. Day13C — Local PCM Fixture Provider（合成 PCM → FFT → formant，不接真实 TTS）

> 新增：`apps/desktop/src/avatar/agent/pcm-spectrum-source.ts`、`local-pcm-fixture-tts-provider.ts`、`local-pcm-formant-pipeline.ts` 及对应 `.test.ts`
> gate：`scripts/avatar/local-pcm-fixture-provider-gate.mjs`
> 收口：commit `feat(avatar): add local PCM fixture provider`（不 push 不 tag，待 BOSS 验收 PASS 后收口 push + tag v0.3.22）

Day13C 把 Day13A 的"预构造频谱帧"升级为"从时域 PCM 采样出发，经过真实 FFT 变换得到频谱"，更接近真实音频处理链路。但**不接任何真实 TTS、不接产品 runtime、不驱动嘴**：

```
LocalPcmFixtureTtsProvider.speak(text)
  → LocalPcmFixturePlaybackSession（内含 PCM + 频谱源）
  → PcmSpectrumSource（PCM → Hann 窗 → radix-2 FFT → 幅度 → dB → 0~255）
  → FormantVisemeRuntimeProbe.update() × N
  → aa / ih / ou / ee / oh（FormantVisemeResult[]）
```

### pcm-spectrum-source.ts
- `PcmSpectrumSource implements AudioSpectrumSource`：从 PCM 采样逐帧计算频域幅度(0~255)。
  - 构造：`sampleRate` / `channelData: readonly number[] | Float32Array` / `frameSize`（默认 1024，必须为 2 的幂）
  - `getFrequencyData()`：取当前窗口(frameSize 个采样) → Hann 窗 → FFT → 幅度 → dB → 0~255 → 频谱底噪(floor=30) → 返回 `Uint8Array`；游标前移 frameSize；到尾部返回全 0 静音
  - `getCursor()` / `resetCursor()`：游标管理
- `buildSyntheticVowelPcm(sampleRate, durationMs, f1, f2, options?)`：用 f1/f2 共振峰模型合成元音 PCM。
  - 原理：基频 f0 产生谐波序列，每个谐波的幅度 = R(f, f1, bw1) + R(f, f2, bw2)（加法模型，确保 f1 和 f2 远距时两端都有能量）
  - R(f, center, bw) = 1 / (1 + ((f - center) / bw)^2)
  - 归一化到 0.9 幅度；不读文件、不解码媒体、不创建音频对象
- 纯 TS radix-2 Cooley-Tukey FFT（迭代式），不依赖浏览器音频 API
- **不创建音频上下文 / 媒体元素 / 缓冲源 / `new Audio()`**

### local-pcm-fixture-tts-provider.ts
- `LocalPcmFixtureTtsProvider implements AudioTtsProvider`：`getCapability()` 返回 `supportsPcm=true, supportsSpectrumSource=true, supportsAudioNode/AudioBuffer=false`；`isAvailable()=true`。
- `speak(text)`：用 `buildMultiVowelPcm()` 拼接五段元音 PCM（aa/ih/ou/ee/oh），返回 `LocalPcmFixturePlaybackSession`。
- `LocalPcmFixturePlaybackSession implements AudioTtsPlaybackSession`：`getPcm()` 返回非 null PCM 数据；`getSpectrumSource()` 暴露 `PcmSpectrumSource`；`getAudioNode/getAudioBuffer` 返回 null；`cancel()` 幂等。
- **不接真实 TTS / 不写 expression**

### local-pcm-formant-pipeline.ts
- `LocalPcmFormantPipeline(provider)`：`speakAndAnalyze(text, frameCount?)` → `provider.speak` → 取频谱源 → `FormantVisemeRuntimeProbe` 逐帧 `update` → 聚合 `LocalPcmPipelineResult { sessionText, results, activeCount, reasons }`。
- `reset()` / `cancel()` 幂等；任何一步抛错吞掉返回空结果。
- `createLocalPcmFormantPipeline(provider)` 工厂。

### 红线（本步已遵守）
- ❌ 不接 edge-tts / kokoro / piper / wlipsync
- ❌ 不创建 AudioContext / MediaElementSource / AudioBufferSourceNode / `new Audio()`
- ❌ 不改 VoidVrmSkin / BrowserTtsController / LipSyncControlOverlay（gate 校验三者不 import 新模块）
- ❌ 不写 `.setValue(`、不驱动 expression
- ❌ 新模块不反向 import runtime / writer / driver（gate 校验）
- ❌ 不使用 `node:fs` / `node:url`（Day13B 教训：desktop tsconfig 不解析 node: 前缀）
- ❌ Day13C gate 的禁用词扫描**仅限本 milestone 新增的 6 个文件**，避免误伤 Day11/Day12/Day13A/B 既有注释（各 gate 互不干扰）

## 13. Day13D — TTS Dependency Spike（kokoro / piper 依赖可行性探针，不安装真实包）

> 新增：`apps/desktop/src/avatar/agent/tts-dependency-spike.ts` 及 `.test.ts`
> 文档：`docs/avatar/day13d-tts-dependency-spike.md`
> gate：`scripts/avatar/tts-dependency-spike-gate.mjs`
> 收口：commit `docs(avatar): add TTS dependency spike`（不 push 不 tag，待 BOSS 验收 PASS 后收口 push + tag v0.3.23）

Day13D 是 Day13B（real-tts-provider-decision）的下游细化：Day13B 做三候选（含 edge）的宏观评估，本模块聚焦 kokoro / piper 两个本地候选的**依赖落地可行性**。**不安装任何真实 TTS 包、不接产品 runtime、不驱动嘴**。

### tts-dependency-spike.ts
- `TtsDependencyCandidate = "kokoro" | "piper"`（edge 本轮不进入）
- `TtsDependencyProbeResult`：10 个字段（candidate / packageAvailable / canRunInBrowser / canRunOffline / canOutputPcm / canOutputAudioBuffer / hasChineseVoice / modelPackagingRisk / runtimeRisk / recommendedNextAction / notes）
- `evaluateTtsDependencyCandidate(candidate)` → 结构化评估
- `rankTtsDependencyCandidates()` → 稳定排序（综合评分：风险权重×2 + 状态分）
- `recommendTtsDependencySpike()` → 排序首位（当前为 kokoro）
- 评估结论：
  - **kokoro**：packageAvailable=true, canRunInBrowser=true, canRunOffline=true, canOutputPcm=unknown, canOutputAudioBuffer=unknown, hasChineseVoice=unknown, modelPackagingRisk=medium, runtimeRisk=medium → 综合评分 7
  - **piper**：packageAvailable=true, canRunInBrowser=unknown, canRunOffline=true, canOutputPcm=true, canOutputAudioBuffer=unknown, hasChineseVoice=unknown, modelPackagingRisk=high, runtimeRisk=high → 综合评分 11
- **不 import 真实 TTS 包 / 不创建音频上下文 / 不写 expression**

### 红线（本步已遵守）
- ❌ 不安装 / import 真实 TTS 包（kokoro-js / piper-tts / edge-tts 均不引）
- ❌ 不创建 AudioContext / MediaElementSource / AudioBufferSourceNode / `new Audio()`
- ❌ 不改 VoidVrmSkin / BrowserTtsController / LipSyncControlOverlay（gate 校验三者不 import 新模块）
- ❌ 不写 `.setValue(`、不驱动 expression
- ❌ 新模块不反向 import runtime / writer / driver（gate 校验）
- ❌ 不使用 `node:fs` / `node:url`
- ❌ Day13D gate 的禁用词扫描**仅限本 milestone 新增的 2 个 .ts 文件**（kokoro / piper 作为候选标识符允许出现；禁止的是真实包名 kokoro-js / piper-tts / edge-tts）

### 下一步（Day14，待 BOSS 拍板）
- **Day14A（已完成）**：Kokoro Provider Minimal Spike —— 动态 import 探测 `kokoro-js`（1.2.1, Apache-2.0），真实合成链路已就位 + graceful fallback；未实际安装包（见上文理由）。详见 `day14a-kokoro-provider-spike.md`。
- **Day14B**：Kokoro Provider Hardening / 或若 kokoro 失败则 Piper Provider Minimal Spike。
- **Day14C**：Kokoro → PCM → Formant pipeline 稳定化。
- **Day15**：再考虑接产品 runtime（让 VOID 嘴动）。
