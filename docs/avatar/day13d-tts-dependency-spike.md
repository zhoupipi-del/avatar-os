# Day13D — TTS Dependency Spike（kokoro / piper 依赖可行性探针）

## 1. 当前 AvatarOS 已有链路

Day11–Day13C 已建立一条完整的"合成音频 → 频谱 → 共振峰 → 口型"测试闭环：

```
AudioTtsProvider (Day11A 接口)
  → LocalPcmFixtureTtsProvider (Day13C, 合成元音 PCM)
  → PcmSpectrumSource (Day13C, PCM → Hann → FFT → 频域幅度 0~255)
  → FormantVisemeRuntimeProbe (Day11C, 逐帧拉频谱 + 分析)
  → analyzeFormantViseme (Day11B, F1/F2 共振峰分类)
  → aa / ih / ou / ee / oh
```

Day13C 证明了"PCM → FFT → 共振峰 → 口型"链路在纯 TS 环境下可跑通。
但 PCM 来自 `buildSyntheticVowelPcm` 数学合成，不是真实语音。

**Day13D 的任务**：评估 kokoro / piper 两个本地真实 TTS 引擎能否替换合成 PCM，
成为"真实语音 PCM"的来源，从而让整条链路处理真实语音数据。

## 2. Day13D 只评估，不安装、不接 runtime

本阶段是**依赖可行性探针（dependency spike）**，不是 runtime integration：

- **不安装**任何真实 TTS 包（kokoro-js / piper-tts 均不引入）
- **不接产品 runtime**（不改 BrowserTtsController / VoidVrmSkin / LipSyncControlOverlay）
- **不让 VOID 嘴动**（不写 expression、不驱动口型）
- **不创建音频上下文**（不实例化 AudioContext / AnalyserNode 等）

评估模块 `tts-dependency-spike.ts` 是纯决策代码，产出结构化评估结论，
为 Day14 选一个 provider 做最小实现提供依据。

## 3. kokoro 评估关注点

kokoro（kokoro-js on npm）是一个 MIT 许可证的本地 ML 语音合成库，
有浏览器 / WASM 运行案例。

| 维度 | 评估 |
|------|------|
| 包能否安装 | npm 包存在，packageAvailable = true |
| 浏览器运行 | 浏览器优先设计，canRunInBrowser = true |
| 离线运行 | 模型加载后不依赖网络，canRunOffline = true |
| 模型包大小 | 模型权重约 80–300MB（视音色而定），modelPackagingRisk = medium |
| 中文音色 | 有中文音色模型（如 zf_xiaoxiao），但质量待验证，hasChineseVoice = unknown |
| PCM 输出 | 输出格式待验证（可能是 Float32Array），canOutputPcm = unknown |
| AudioBuffer 输出 | 待验证，canOutputAudioBuffer = unknown |
| 运行时风险 | WASM / WebGPU 首包加载延迟，runtimeRisk = medium |

**kokoro 优势**：浏览器优先、MIT 许可证、离线运行、模型包中等。
**kokoro 风险**：中文音色质量、输出格式未验证、WASM 首包加载。

## 4. piper 评估关注点

piper（piper-tts）是一个 MIT 类许可证的本地 ML 语音合成库，
原生输出 PCM / WAV，本质是 C++ / ONNX 引擎。

| 维度 | 评估 |
|------|------|
| 包能否安装 | npm 包 / WASM 端口存在，packageAvailable = true |
| 浏览器运行 | piper 本质是 C++ / ONNX，WASM 端口成熟度待验证，canRunInBrowser = unknown |
| 离线运行 | 模型加载后不依赖网络，canRunOffline = true |
| 模型包大小 | ONNX 模型 + 音素化器 + espeak 数据，modelPackagingRisk = high |
| 中文音色 | 有中文模型但可得性 / 质量待验证，hasChineseVoice = unknown |
| PCM 输出 | 原生输出 raw PCM / WAV，canOutputPcm = true |
| AudioBuffer 输出 | 需手动转换，canOutputAudioBuffer = unknown |
| 运行时风险 | WASM 执行 + 音素化器在浏览器中的运行路径复杂，runtimeRisk = high |

**piper 优势**：原生 PCM 输出、MIT 许可证、离线运行。
**piper 风险**：浏览器兼容性未验证、打包复杂度高、音素化器运行路径复杂。

## 5. edge 暂不进入本轮

edge（基于 Edge 在线朗读服务的非官方封装）在 Day13B 评估中排末位：
- 在线依赖（无离线能力）
- 许可证风险高（GPLv3 类）
- 服务协议与 API 稳定性不在掌控

Day13D 只评估 kokoro / piper 两个本地候选，edge 暂不进入。

## 6. 推荐 Day14 只选一个 provider

当前评估结论：**kokoro 排首位**（综合评分更低），piper 次之。

| 候选 | 综合评分 | 关键优势 | 关键未决项 |
|------|----------|----------|------------|
| kokoro | 7 | 浏览器优先、模型包中等 | 中文音色、输出格式 |
| piper | 11 | 原生 PCM 输出 | 浏览器兼容性、打包复杂度 |

评分计算：风险权重 ×2 + 状态分（true=0, unknown=1, false=2）。

**推荐**：Day14A 先做 kokoro 最小实现（安装包 → 加载中文音色 → 验证 PCM 输出 → 接 Day13C 频谱管线）。
若 kokoro 中文音色不可用或输出格式不兼容，翻转到 piper。

Day14 路线（待 BOSS 拍板）：
- **Day14A**：只选一个 provider 做最小实现（kokoro 优先）
- **Day14B**：把真实 provider 输出接 Local PCM / Formant pipeline
- **Day15**：再考虑接产品 runtime（让 VOID 嘴动）

## 模块 API

```typescript
// 候选标识
type TtsDependencyCandidate = "kokoro" | "piper";

// 探针结论
interface TtsDependencyProbeResult {
  candidate: TtsDependencyCandidate;
  packageAvailable: boolean | "unknown";
  canRunInBrowser: boolean | "unknown";
  canRunOffline: boolean | "unknown";
  canOutputPcm: boolean | "unknown";
  canOutputAudioBuffer: boolean | "unknown";
  hasChineseVoice: boolean | "unknown";
  modelPackagingRisk: "low" | "medium" | "high";
  runtimeRisk: "low" | "medium" | "high";
  recommendedNextAction: string;
  notes: string;
}

// 评估函数
evaluateTtsDependencyCandidate(candidate: TtsDependencyCandidate): TtsDependencyProbeResult
rankTtsDependencyCandidates(): TtsDependencyProbeResult[]
recommendTtsDependencySpike(): TtsDependencyProbeResult
```
