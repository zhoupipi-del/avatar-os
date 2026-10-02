# Day14D — Kokoro Output Normalizer + HF Access Strategy

> 新增：`apps/desktop/src/avatar/agent/kokoro-output-normalizer.ts`、`kokoro-access-diagnostics.ts`、`kokoro-normalized-formant-pipeline.ts` 及对应 `.test.ts`
> gate：`scripts/avatar/kokoro-output-normalizer-gate.mjs`（`pnpm avatar:kokoro-output-normalizer-gate`）
> 收口：commit `feat(avatar): add Kokoro output normalizer`（不 push tag、不 --follow-tags；`v0.3.26` 钉在 Day14C 提交上不移动）

## 0. 结论先行

Day14D 是两个目标的合并：

1. **输出归一化做实**：kokoro 合成产物（形状未知）稳定归一化为 `{ sampleRate, channels: [Float32Array] }`，接入既有 formant 管线。
2. **HF 访问失败结构化**：Day14C 手动真实 smoke 的结构化失败（本机混合代理对 HTTPS GET 返回 401 / Invalid username or password）被分类为 `proxy-auth-required` / `hf-unauthorized` 等结构化类型，为 Day14E 访问策略提供决策输入。

**不接产品 runtime、不写 expression、不让 VOID 嘴动、普通 gate 不触发模型下载。**

## 1. 链路

```
unknown kokoro output
  -> normalizeKokoroAudioOutput()            (Day14D normalizer)
  -> { sampleRate, channels: [Float32Array] }
  -> PcmSpectrumSource                       (Day13C)
  -> FormantVisemeRuntimeProbe.update() x N  (Day11C)
  -> aa / ih / ou / ee / oh summary

模型加载失败 error
  -> classifyKokoroAccessError()             (Day14D diagnostics)
  -> proxy-auth-required | hf-unauthorized | network-unreachable | ...
  -> getKokoroAccessHint() / buildKokoroAccessReport()
```

## 2. kokoro-output-normalizer.ts

- `NormalizedKokoroPcm`：`sampleRate` / `channels: [Float32Array]` / `frameCount` / `durationMs` / `sourceShape`
- `normalizeKokoroAudioOutput(output, options?)` → `KokoroNormalizeResult { ok, pcm, error }`：无效输出返回结构化失败，**绝不 throw**
- `extractSampleRate(output, fallback?)`：识别 `sampling_rate` / `sampleRate` / `sample_rate` / `sr`（顶层 + 一层嵌套），fallback 默认 24000
- `extractFloat32Audio(output)`：识别形状——
  - `Float32Array` 本体 / `number[]`
  - `{ audio | pcm | data | samples | waveform: Float32Array | number[] }`
  - 一层嵌套 RawAudio 包裹形 `{ audio: { audio, sampling_rate } }`
- 纯数据变换：不发网络请求、不触发模型下载、不读文件、不创建音频对象

## 3. kokoro-access-diagnostics.ts

- `KokoroAccessFailureKind`：`none | proxy-auth-required | hf-unauthorized | network-unreachable | model-not-found | module-missing | api-missing | model-load-failed | unknown`
- `classifyKokoroAccessError(error)`：字符串证据分类（优先级：代理认证 > 401/Unauthorized > 网络 > 404 > 模块 > API > 其他）
  - `Invalid username or password` / `Proxy Authentication Required` / 407 → `proxy-auth-required`
  - 401 / `Unauthorized` → `hf-unauthorized`
  - ENOTFOUND / ECONNREFUSED / ETIMEDOUT / ECONNRESET / fetch failed → `network-unreachable`
  - 404 / not found → `model-not-found`
- `getKokoroAccessHint(kind)`：修复提示，**不含任何明文凭据 / 代理地址**
- `buildKokoroAccessReport({ moduleLoaded, apiAvailable, error })`：汇总报告 + `isAccessIssue` 标记（proxy/hf/network 三类为访问配置问题，非代码问题）
- 纯字符串分类：不发网络请求、不带真实凭据

## 4. kokoro-normalized-formant-pipeline.ts

- `analyzeNormalizedKokoroOutput(output, options?)` → `NormalizedKokoroAnalysisSummary`
  - `normalized` / `sampleRate` / `frameCount` / `activeResultCount` / `dominantShapes` / `reasons` / `results` / `error`
  - options：`fallbackSampleRate` / `frameSize`（默认 1024）/ `noiseGate` / `maxFrames`（默认 64）
  - 任何一步失败返回结构化 summary，**绝不 throw**
- `KokoroNormalizedFormantPipeline` / `createKokoroNormalizedFormantPipeline(options?)`：便利封装，`reset()` 幂等
- 不接 VRM / UI / expression

## 5. Day14C 实测失败的归类（本模块的直接动机）

| 实测证据 | 分类 | 性质 |
|----------|------|------|
| `Unauthorized access to file: ".../tokenizer_config.json"` | `hf-unauthorized` | 访问配置问题 |
| 代理探测复现：`401` + `Invalid username or password.` | `proxy-auth-required` | 访问配置问题 |

根因：本机混合代理对 HTTPS GET 要求身份认证，模型权重拉取未携带凭据被拒。
**Day14D 不硬上代理凭据**——访问策略（直连 / 带凭据代理 / 镜像 / 本地缓存）推迟到 Day14E 配置冒烟。

## 6. 测试（13 项）

- normalizer 7 项：Float32Array / number[] / RawAudio / 嵌套 RawAudio / 备选键形（pcm/data/samples）/ 无效输出结构化失败 / fallbackSampleRate
- diagnostics 5+ 项：401 文件访问 → hf-unauthorized、Invalid username → proxy-auth-required、404 → model-not-found、网络四型 → network-unreachable、hint 全类非空且不泄露凭据、report 汇总
- pipeline 3+ 项：合成元音 PCM → active formant summary（aa 命中）、无效路径不 throw、reset 幂等

## 7. gate（8 条规则）

1. 8 个必需文件存在（先 assertFile 防呆）
2. normalizer 4 个 API 存在
3. diagnostics 类型 + 3 个 API + 三个关键 kind 存在
4. pipeline API 存在，且三个新模块**不出现** `from_pretrained(` / `.generate(`（模型加载仅允许留在 Day14C smoke 模块）
5. 三个产品文件不 import Day14D 新模块
6. 禁用词扫描（仅限本 milestone 新增 6 个 .ts 文件，gate 互不干扰）
7. 新模块不反向 import runtime / writer / driver；index.ts 已导出 3 个新模块
8. 四道基础闸门全绿

## 8. 红线（本步已遵守）

- ❌ 不接产品语音控制器 / 皮肤组件 / 口型面板
- ❌ 不写 expression、不让 VOID 嘴动
- ❌ 不创建任何音频上下文 / 音频节点 / 媒体元素
- ❌ 不使用 node 内置模块
- ❌ 普通 gate / CI 不触发模型下载（新模块无 from_pretrained）
- ❌ 不写代理凭据到代码 / 日志 / 提示文本
- ❌ 不移动 `v0.3.26` tag（钉在 Day14C 提交），不 push tag、不 --follow-tags

## 9. 下一步（Day14E，待 BOSS 拍板）

Day14E — Kokoro Access Configuration Smoke：在 env 门控下按序尝试
1. 直连（绕过代理）
2. 带凭据代理（凭据仅从环境读取，不落盘）
3. HF 镜像 endpoint
4. 本地模型缓存
每种策略产出结构化结果，接 Day14D 的 diagnostics 分类，选出本机可用的模型获取路径；之后 Day15 再考虑接产品 runtime。
