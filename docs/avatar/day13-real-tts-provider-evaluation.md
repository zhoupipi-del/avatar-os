# Day13B — Real TTS Provider Evaluation（真实 TTS 路线评估）

> 生成于 Day13B（2026-07-28）。配套决策模块：`apps/desktop/src/avatar/agent/real-tts-provider-decision.ts`
> gate：`scripts/avatar/real-tts-provider-evaluation-gate.mjs`
> 收口指令：`git commit -m "docs(avatar): evaluate real TTS provider options"`（不 push 不 tag，待 BOSS 验收 PASS 后收口）

## 0. 一句话结论

Day13B **不做选型实装**，只对 `edge` / `kokoro` / `piper` 三条真实 TTS 路线做结构化评估与排序，产出决策矩阵与下一步建议。真实接线推迟到 Day13C/D 的最小 spike。

## 1. AvatarOS 当前链路（已验证的测试闭环）

```
AudioTtsProvider（接口，Day11A）
  └─ AudioFixtureTtsProvider（Day13A：循环频谱帧，supportsSpectrumSource=true）
       └─ AudioFixturePlaybackSession.getSpectrumSource()
            └─ CyclingFrequencySpectrumSource（元音帧循环，模拟可分析音频）
                 └─ FormantVisemeRuntimeProbe.update() × N
                      └─ analyzeFormantViseme() → aa / ih / ou / ee / oh
```

- 这条链路**全程无真实音频**：频谱来自 fixture 帧，不解码 WAV、不创建 `AudioContext`、不写 expression。
- 它证明了"provider → 频谱源 → 共振峰探针 → 元音口型"的**接口契约可行**。
- 还差的一环：**真实 TTS 提供方**，它能产出"可分析音频"（AudioNode / AudioBuffer / PCM / 频谱源），把 fixture 换掉。这正是 Day13B 评估的对象。

## 2. 三候选评估

> 评估维度：许可证风险 / 运行时风险 / 打包风险 / 离线支持 / 浏览器(WebView)支持 / 预期音频输出。
> 数据来源：Day13B 指令中的三候选权衡 + 当前外部信息（许可证标注、运行形态、离线案例）。

### 2.1 edge（基于 Edge 在线朗读服务的非官方封装）

| 维度 | 评估 |
|------|------|
| 许可证风险 | **高** — 相关 JS/Node 包标注偏严格（GPLv3 类），对 AvatarOS 分发有传染风险 |
| 运行时风险 | **高** — 依赖微软在线朗读服务，非官方、协议与 API 稳定性不在掌控 |
| 打包风险 | **中** — npm 可装，但强依赖外网，无离线兜底 |
| 离线支持 | ❌ 无 |
| 浏览器支持 | ✅（Node/Bun 包） |
| 预期输出 | WAV / 音频流 |

**优点**：实现最快，调在线服务即可拿到音频。
**缺点**：在线 + 非官方 + 许可证严格，长期稳定性与合规都要谨慎；且无法离线。

### 2.2 kokoro（本地 ML 语音库）

| 维度 | 评估 |
|------|------|
| 许可证风险 | **低** — MIT |
| 运行时风险 | **中** — 模型包 / WASM / WebGPU / 首包加载时延 |
| 打包风险 | **中** — 需随包分发模型权重与运行时 |
| 离线支持 | ✅ 有离线本地运行案例 |
| 浏览器支持 | ✅（浏览器前端库，Tauri WebView 可承载） |
| 预期输出 | AudioBuffer / PCM |

**优点**：许可证友好、本地潜力最强、中文"啊/一/呜/耶/哦"映射合理。
**缺点**：引入模型权重 + WASM/WebGPU 运行时，首包加载与集成成本不低；中文音色质量需实机验证。

### 2.3 piper（本地 ML 语音库）

| 维度 | 评估 |
|------|------|
| 许可证风险 | **低** — MIT 类 |
| 运行时风险 | **中** — 模型 / wasm / 中文音色需验证 |
| 打包风险 | **中** — 需打包 wasm 与模型文件 |
| 离线支持 | ✅ 本地离线潜力强 |
| 浏览器支持 | ✅（浏览器前端库） |
| 预期输出 | AudioBuffer / PCM（WAV → AudioBufferSourceNode） |

**优点**：离线、音频流可直接转 AudioBuffer 接下游共振峰分析。
**缺点**：本质是浏览器库，wasm + 模型打包路径、中文音色可得性需 spike 验证。

## 3. 决策矩阵（综合排序）

| 候选 | 许可证 | 运行时 | 打包 | 离线 | 浏览器 | 输出 | 综合 |
|------|--------|--------|------|------|--------|------|------|
| **kokoro** | 低 | 中 | 中 | ✅ | ✅ | AudioBuffer | **最优** |
| **piper** | 低 | 中 | 中 | ✅ | ✅ | AudioBuffer | 次优（tie） |
| **edge** | 高 | 高 | 中 | ❌ | ✅ | WAV | 末位 |

排序规则：风险评分（低=0/中=1/高=2 求和），离线支持减分优待；同分按候选名确定性 tie-break。
→ 当前 `recommendNextProvider()` 返回 **kokoro**；piper 紧随其后。

## 4. 推荐下一步（Day13C）

**不急着选边开写**，先做最小 spike 验证"本地依赖可得性 + 中文音色"：

1. **Day13C 选项 A — Local Audio File Provider**：先用本地 WAV / base64 音频文件验证"真实音频文件 → 频谱源 → 口型"全链路（不引入任何 ML 依赖，风险最低）。
2. **Day13C 选项 B — kokoro / piper 最小 spike**：在隔离模块里实装一个 `implements AudioTtsProvider` 的本地 provider，仅验证"能产出 AudioBuffer → 接 Day11C/Day12 探针"，**不接产品 runtime、不驱动 VOID 嘴型**。

具体以"本地依赖评估结果"（包是否可装、中文音色是否可得、首包加载时延是否可接受）为准，可能从 kokoro 翻转到 piper。

## 5. 红线（本阶段已遵守 / 后续仍需遵守）

- ❌ 不 import 任何真实 TTS 包（edge / kokoro / piper 的 npm 包均不引，仅评估）。
- ❌ 不创建 `AudioContext` / `AnalyserNode` / `MediaElementSource` / `AudioBufferSourceNode`。
- ❌ 不写 expression、不接 `VoidVrmSkin` / `BrowserTtsController` / `LipSyncControlOverlay`。
- ❌ 不接产品 runtime，不让 VOID 嘴动（本阶段只是决策 + 评估模块）。
- ✅ 决策模块 `real-tts-provider-decision.ts` 为纯评估逻辑，可单测，不依赖任何外部运行时。
